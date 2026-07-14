# Summary

## 结果

用户验收通过。YPI Studio 任务弹窗与浮窗完成计划/原型入口、完整八站状态图与改进验收体验优化。

## 交付

1. **改进计划只读快速预览**：任务详情与主「计划审批书」同级展示 `改进计划 · IMP-xxx`；显式 `taskKey + improvementId`；不可在弹窗/浮窗改计划。
2. **计划审批书 / HTML 原型常驻**：由 artifact registry 驱动，不因离开 `awaiting_approval` 消失；审批后显示「已批准 / 已确认」态。
3. **HTML 原型**：task-local files API `mode=preview` 新开页；CSP sandbox 边界保持。
4. **八站状态图**：Brief → Design → Implement → Checks → Review → User Acceptance → Completed → Archived；运行证据优先，避免规划 md 误标。
5. **站点动效**：当前/待确认节点光圈；出站连接线流光；completed/archived 静态；尊重 reduced-motion。
6. **浮窗改进验收**：仅 `waiting_user_acceptance` 显示确认入口 → Dialog → 既有 `transition_improvement → accepted`；主任务不自动 completed。

## 验证

- 自动：`npm run lint`、`tsc --noEmit`、`npm run test:studio-dag` 通过。
- 检查员：Pass，无阻塞。
- 用户：`npm run dev` @30142 实机验收通过（含连接线流光与当前节点光圈）。

## 知识要点

- 入口“消失”主因是审批态门控 entry 生成，不是内容截断。
- 浮窗投影保持有界：文件名/scope/审批态/动作目标，不带正文。
- 预览路径只读，不写 approval grant。