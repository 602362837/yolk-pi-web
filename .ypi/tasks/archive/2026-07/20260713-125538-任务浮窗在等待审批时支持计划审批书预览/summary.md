# Summary：任务浮窗在等待审批时支持计划审批书预览

## 结果
已完成。用户验收通过。

## 交付
- `lib/ypi-studio-task-preview.ts`：共享 task-local 相对链接与预览 URL helper
- `components/YpiStudioPlanReviewModal.tsx`：只读计划审批书 modal（按需读取、Markdown、loading/error/retry、a11y）
- `components/YpiStudioSessionWidget.tsx`：`awaiting_approval` / `waiting_plan_approval` 入口
- `components/AppShell.tsx`：传入 `cwd` / `onOpenFile`
- `docs/modules/frontend.md`（及相关 library 文档）：记录行为与边界

## 行为
- 主任务 `awaiting_approval`：浮窗显示「计划审批书」
- 改进项 `waiting_plan_approval`：显示「计划审批书 · IMP-xxx」
- 点击后 modal 按需读取对应 `plan-review.md`；只读，不写 approval grant

## 验证
- lint / tsc / test:studio-dag 通过
- checker Pass
- 用户验收通过