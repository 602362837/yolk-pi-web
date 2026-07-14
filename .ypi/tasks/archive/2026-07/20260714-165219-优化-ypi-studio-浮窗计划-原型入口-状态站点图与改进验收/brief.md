# Brief：YPI Studio 浮窗计划/原型入口、完整状态与改进验收

## 目标

让绑定当前 Session 的 YPI Studio 浮窗和任务详情在任务全生命周期内都能快速查看计划与 HTML 原型，并让用户在改进项实现、检查完成后从浮窗明确验收该改进项；所有预览保持只读，所有状态写入继续经过现有 Studio API 与状态机。

## 已核实现状

- `components/YpiStudioSessionWidget.tsx` 已复用 `YpiStudioPlanReviewModal`，但 `planReviewEntriesForTask()` 仅在主任务 `awaiting_approval` 或改进项 `waiting_plan_approval` 时生成入口。因此批准后入口消失是**状态条件门控**，不是 Markdown 内容/API 截断；浮窗中其他 `.slice()` 只限制子任务、运行和事件摘要。
- 浮窗站点图硬编码为 `Brief → Design → Implement → Checks → Review`。`workflowStageForStep()` 只把 `ready/completed` 映射到 Review，未表达 `review`、`user_acceptance`、`waiting_for_improvements`、`completed` 和 `archived` 的完整后段语义。
- `lib/ypi-studio-session-link.ts` 的 widget projection 已有完整任务 artifact evidence 和有界 improvement 状态，但未投影可常驻打开的计划/HTML 文件描述，也未投影执行浮窗验收所需的明确目标和结果刷新契约。
- `components/YpiStudioPanel.tsx` 的改进详情可在多层 Tab 内查看实例 `plan-review.md`，但改进列表/任务详情缺少与主「计划审批书」同级的快速只读入口。
- 现有 `PATCH /api/studio/tasks/[taskKey]` 的 `transition_improvement` 已支持 `waiting_user_acceptance → accepted`，会记录 acceptance、reconcile 全部改进并在全部解决后把主任务从 `waiting_for_improvements` 返回 `review`。无需新增旁路 grant。
- `lib/ypi-studio-task-preview.ts` 与 files API 已提供 task/improvement-scoped 只读 Markdown/HTML 打开、安全路径解析和 CSP sandbox，应继续复用。

## 范围

### 范围内

1. 任务详情的改进计划快速只读预览。
2. 浮窗计划审批书与 HTML 原型入口常驻，并显示待审批/已批准等文字、图标和颜色状态。
3. 浮窗完整八站状态：Brief、Design、Implement、Checks、Review、User Acceptance、Completed、Archived。
4. `waiting_user_acceptance` 改进项在浮窗经确认对话框后调用现有 API 验收。
5. 主/改进目标显式寻址、刷新、错误态、可访问性、文档与回归验证。

### 范围外

- 在浮窗/任务详情编辑计划。
- 在预览接口写 approval grant，或从预览点击批准计划。
- 绕过 `awaiting_approval` / `waiting_plan_approval` 门禁。
- 新建验收 grant、并行状态机或新的任务数据文件。
- 从浮窗完成/归档主任务，或改变 Session-bound 多任务筛选、排序和 360px 桌面宽度。

## UI 门禁

已指派 UI 设计员，并产出 [ui.md](ui.md) 与 [HTML 原型](ypi-studio-widget-state-prototype.html)。原型仅供计划审批；未获得用户明确批准前不得实现。
