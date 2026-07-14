# 计划审批书：YPI Studio 浮窗计划/原型入口、完整状态与改进验收

## 本次要解决什么

当前浮窗的计划审批书入口由审批状态临时门控，批准后便消失；站点图硬编码止于 Review；改进计划在任务详情缺少同级快速预览；改进结果完成后仍需回到 Chat 才能验收。本计划在不改变审批门禁、Session-bound 多任务和 360px 宽度的前提下补齐这些体验。

## 计划摘要

1. **常驻只读材料入口**：以完整 artifact registry 和明确文件描述驱动计划审批书、改进计划与 HTML 原型入口，不再依赖“当前正等待审批”才显示。批准后入口保留，以文字、图标和颜色变为已批准/已确认。
2. **安全复用**：Markdown 继续走现有只读 modal；HTML 继续走 task-local files API `mode=preview` 并新开页。主/改进文件必须显式 `taskKey + improvementId`，预览不写 grant。
3. **完整八站**：`Brief → Design → Implement → Checks → Review → User Acceptance → Completed → Archived`，在 360px 卡片内两行展示，运行证据优先，不能因已有规划文档误标完成。
4. **改进浮窗验收**：仅 `waiting_user_acceptance` 改进项显示“确认该改进任务已完成”；用户在确认对话框明确确认后调用既有 `transition_improvement → accepted`。全部改进解决后主任务只回到 Review 再次验收，不自动完成。
5. **有界投影与兼容**：widget 只增加文件名、scope、审批态和动作目标，不携带正文/反馈/Transcript；无数据迁移，旧任务兼容。

## 根因结论

入口“过了截断会消失”的主要根因不是内容截断：`planReviewEntriesForTask()` 当前只接受主任务 `awaiting_approval` 和改进项 `waiting_plan_approval`。状态变化后 entry 根本不再生成。站点缺失则来自五站硬编码和后段状态映射缺口。

## 审阅材料

- [Brief：现状、范围与根因](brief.md)
- [PRD：需求与验收标准](prd.md)
- [UI：交互、状态与门禁](ui.md)
- [HTML 交互原型（必须审阅）](ypi-studio-widget-state-prototype.html)
- [Design：模块、数据流、安全和兼容性](design.md)
- [Implement：执行顺序与机器可读计划](implement.md)
- [Checks：自动与人工验收清单](checks.md)

## 需要用户确认

- 「改进计划」按改进实例 scoped 的 `plan-review.md` 定义，作为改进师面向用户的可审批计划；结构化 DAG 仍在执行进度中展示，不新增第二份可编辑计划。
- 浮窗直达动作只验收改进结果，不提供主任务完成/归档按钮，也不提供计划批准按钮。
- 请确认 HTML 原型中的八站两行布局、常驻按钮态和确认对话文案。

## 审批请求

请打开 HTML 原型并审阅以上材料，然后明确回复“批准该计划和 HTML 原型进入实现”，或提出修改意见。仅打开预览不构成批准；在用户明确批准前不得进入实现。
