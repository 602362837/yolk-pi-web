# PRD — IMP-005 修复浮窗验收最后一个改进后主任务停在 review

## 问题
用户通过任务浮窗点击「确认该改进任务已完成」验收最后一个改进项后，服务端 reconcile 会把主任务从 `waiting_for_improvements` 切回 `review`。但浮窗主任务验收按钮只在 `user_acceptance` 显示，导致用户无法在浮窗里继续验收主任务。

## 根因
`lib/ypi-studio-tasks.ts` 的 `reconcileYpiStudioImprovements()` / `reconcileImprovementsInLock()` 在 unresolved 改进数为 0 时固定执行：

`waiting_for_improvements -> review`

这是通用状态机回收，但浮窗的“改进验收”操作代表用户已经在验收上下文中，下一步应进入“请求主任务再次验收”的 `user_acceptance`，否则主任务验收按钮被门禁隐藏。

## 目标
- 修复从浮窗验收最后一个改进项后的必现卡住问题。
- 保留主任务 `completed` 必须由用户显式点击主任务验收按钮触发。
- 不让最后一个改进验收直接 completed。
- 不影响仍有未解决改进项时的等待改进行为。

## 非目标
- 不改变计划审批逻辑。
- 不让 review 状态通用地绕过用户验收。
- 不改变改进项验收按钮文案。
