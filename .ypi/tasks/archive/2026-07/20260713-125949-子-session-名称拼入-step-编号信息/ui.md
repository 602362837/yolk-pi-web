# UI

## 原型门禁判断

- **触发：是。** 虽然不新增页面或操作，但侧栏 session 主标题从“子任务标题”变为“step id + 子任务标题”，属于用户可见信息结构变化。
- **当前状态：用户已批准（2026-07-13，主会话明确回复「批准」）。**
- 原型文件路径：[session-step-title-prototype.html](session-step-title-prototype.html)

## 给 UI 设计员的任务

请基于现有 `components/SessionSidebar.tsx` 与历史原型 `.ypi/tasks/archive/2026-07/20260708-100104-修复左侧-session-窄宽换行与-studio-子任务-session-命名/ui-prototype.html`，产出本任务独立、自包含的 HTML 原型（建议文件名 `session-step-title-prototype.html`）。至少覆盖：

1. 有 step 的 implementer/checker child：`{subtask.id} · {subtask.title}`。
2. 同一主任务多个不同 step 并列时能快速区分。
3. 无 `subtaskId` 的 architect/improver child：`{member} · {taskTitle}`，不出现编号。
4. 超长 id、超长中文/英文 title、约 160px 窄侧栏下的 ellipsis。
5. title、badge、detail、tooltip 的信息分工：主标题优先 step id/title；badge/detail 保留 member/status/run short id；tooltip 可看完整值。
6. 不改变行高、hover、点击、归档等现有交互。

## 目标文案示例

- `STEP-01 · 增加共享 child session 标题 helper`
- `CHECK-02 · 验证历史 session 投影与截断`
- `architect · 子 session 名称拼入 step 编号信息`

## 审批记录

- HTML 原型：**已产出**。[点击查看 session-step-title-prototype.html](session-step-title-prototype.html)
- 用户审批：**已批准**（2026-07-13，用户在主会话明确回复「批准」；同时确认以 `subtask.id` 为唯一 step 编号口径）。
- 结论：原型与计划均已获批，可进入 implementing。
