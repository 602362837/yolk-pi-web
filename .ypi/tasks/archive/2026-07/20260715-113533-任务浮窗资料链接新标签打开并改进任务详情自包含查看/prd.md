# PRD — IMP-003 任务浮窗主任务用户验收

## 目标与背景

改进项已支持在会话浮窗一键验收；主任务在 `user_acceptance` 仍只能靠 Chat 口头确认。本改进为绑定会话的浮窗补齐主任务结果验收入口，走既有状态机 `user_acceptance → completed`。

## 用户价值

- 用户在浮窗即可完成主任务验收，不必切换到 Chat 口述。
- 与改进验收交互一致：二次确认、绑定会话、失败可感知。
- 不削弱服务端安全/门禁：未解决改进、归档、未绑定会话仍不可完成。

## 范围内

1. Widget projection 暴露主任务可验收标志。
2. 浮窗主任务验收按钮 + AppPrompt 二次确认。
3. 确认后 PATCH 主任务 transition → `completed`，携带 `contextId` 与 `reason`。
4. 与改进验收按钮文案/视觉区分。
5. loading、成功 toast、失败 toast + 刷新。
6. 文档与轻量 helper 测试。

## 范围外

- 计划审批（`awaiting_approval`）按钮化。
- 详情面板主任务验收/归档写按钮。
- `review → user_acceptance` 或 `ready → completed` 的一键捷径。
- 自动 completed、跳过确认、绕过 unresolved / archive / binding 门禁。
- 修改 workflow 图或 approval grant 语义。

## 功能需求与验收标准

### R1 可见性

- **显示**当且仅当：
  - 任务未归档；
  - `status === "user_acceptance"`；
  - 未解决改进数 `=== 0`（无 instances 或全部 `accepted` / `accepted_not_doing`）。
- 有 unresolved 改进、`waiting_for_improvements`、`review`、`ready`、`completed`、archived **不显示**主任务验收按钮。
- `review_ready` 提示可保留；不得仅凭 `review_ready` 显示 completed 按钮。

### R2 二次确认

- 点击后打开 AppPrompt，文案明确：
  - 这是**主任务结果验收**，不是计划审批，也不是改进验收；
  - 确认后状态变为 `completed`；
  - 不会自动归档。
- 取消不写任何 PATCH。

### R3 写路径

- 确认后 `PATCH /api/studio/tasks/{taskKey}`：
  - `cwd`
  - `to: "completed"`
  - `contextId`（绑定会话，必填于客户端）
  - `reason`（非空，满足 `requiresUserApproval`）
  - 可选 `action: "transition"`；不得使用 `transition_improvement`。
- 缺 `cwd` / `contextId`：不发请求，toast 说明。
- 成功：success toast + `onTaskChanged` 刷新；按钮消失（状态已非 `user_acceptance`）。
- 失败：error toast + 刷新；不乐观本地 completed。

### R4 与改进验收共存

- 同一卡片上改进验收与主任务验收不得同时显示（因 unresolved>0 时主任务按钮隐藏）。
- 文案：
  - 改进：`确认该改进任务已完成`
  - 主任务：`确认主任务已验收完成`
- 视觉：主任务按钮使用独立样式 token（建议 success/accent 实心），改进保持现有警告橙。

### R5 无副作用越权

- 不写 approval grant。
- 不 archive。
- 不修改 improvement 状态。
- 不在 projection 中塞入 feedback/正文。

## 非功能

- 复用现有 AppPrompt / toast / in-flight 互斥模式。
- 服务端门禁仍是权威；客户端标志仅便利。
- 键盘可达；`aria-label` 说明主任务结果验收。
- reduced-motion 下无新增动画动画。

## 未决问题

无阻塞。若审批时要求 `review` 也可一键完成，需明确扩展范围后再实现。
