# PRD - 修复改进任务派发闭环与成员运行记录丢失

## 问题

父任务 `20260711-185646` 实现了主任务下的改进流程，但检查员发现 2 个阻塞问题：

### B1 - 改进任务派发闭环未打通
改进任务创建后可以存储 plan、进入 waiting_plan_approval/implementing/checking 状态，但实现员和检查员**无法领取改进任务里的子任务**。

**原因**：
- 缺少 `claim_improvement_subtask` action
- `implementation_next` 不支持 `improvementId` 参数
- `ypi_studio_subagent` 不接受 `improvementId` 参数
- 主任务在 `waiting_for_improvements` 时仍只能认主任务 plan

**结果**：改进流程卡死，无法执行。

### B2 - 成员运行记录丢失
改进任务的 `instance.runIds` 字段初始化为空数组后**从未被写入**。

**结果**：UI "成员运行" Tab 永远为空，无法看到改进任务的运行历史。

## 目标

1. 改进任务的实现员可以通过 `claim_improvement_subtask` 领取改进子任务并执行
2. 改进任务的检查员同样可以领取改进子任务进行 review
3. 改进任务跑过的成员运行，其 `runId` 被正确写入 `instance.runIds`
4. UI "成员运行" Tab 能正确展示改进任务的运行记录
5. 有对应的契约测试覆盖上述场景

## 范围

**范围内**：
- types、tasks library、extension tool、API route、DAG 测试

**范围外**（以后再说）：
- UI 变更
- 主流程逻辑
- approvalMode=inherit
- reconcile_improvements API
- 事件 feedback 有界化
- improver thinking 产品决策

## 验收标准

- 改进任务的实现员可以领取改进子任务并执行
- 改进任务的检查员可以领取改进子任务进行 review
- 主/实例 plan 完全隔离，作用域错误时拒绝
- `instance.runIds` 正确记录所有 run，重复写入不重复
- `npm run test:studio-dag`、`lint`、`tsc` 通过

## 参考

- 父任务检查报告：`../20260711-185646-完善-ypi-studio-设计审批同步与改进孪生流程/review.md`
