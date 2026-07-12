# 修复改进任务派发闭环与成员运行记录丢失 - 审批书

## 修复内容

本次只修复 2 个阻塞问题：

### B1 - 改进任务派发闭环
**问题**：改进任务创建后，实现员和检查员无法领取改进任务里的子任务，改进流程卡死。

**修复**：
- 新增 `claim_improvement_subtask` action
- `implementation_next` 支持 `improvementId` 参数
- `ypi_studio_subagent` 接受 `improvementId` 参数
- 严格隔离主任务 plan 和改进任务 plan

### B2 - 成员运行记录丢失
**问题**：改进任务的 `instance.runIds` 从未被写入，UI 永远为空。

**修复**：
- subagent start 成功后写入 `instance.runIds`
- 完成/取消时保持一致性

## 实施计划

| 步骤 | 任务 | 改什么 |
|------|------|--------|
| 1 | 类型定义 | 新增改进任务 claim body 和 run 的 improvementId 字段 |
| 2 | 核心库 | 实现改进任务的 next/claim/run 持久化，隔离主任务 plan |
| 3 | 工具/API 接入 | 接入 extension tool、subagent、PATCH route |
| 4 | 测试 | DAG 契约测试 + 文档 |

## 不改的东西

- UI 不改
- 主流程逻辑不改
- I1-I5 重要问题不修（以后再说）

## 验收标准

- 改进任务的实现员可以领取改进子任务并执行
- 改进任务的检查员可以领取改进子任务进行 review
- 改进任务跑过的成员运行，`runId` 正确写入 `instance.runIds`
- UI "成员运行" Tab 能展示改进任务的运行记录
- 有契约测试覆盖

## 风险

- 改动涉及核心派发逻辑，可能影响主任务
- 需要严格的契约测试验证隔离性

## 参考

- 父任务检查报告：`.ypi/tasks/20260711-185646-完善-ypi-studio-设计审批同步与改进孪生流程/review.md`
- 详细设计：`design.md`
