# UI

## 门禁状态

- 是否触发 UI 原型门禁：是。
- 原因：左侧 Session 列表窄宽展示、hover 操作、Studio child session 标题均为用户可见信息结构/交互展示变化。
- 当前状态：已产出 HTML 原型；用户已在主会话明确批准。
- 实现限制：已满足审批门禁，可进入实现。

## 给 ui-designer 的原型任务

请基于现有 `components/SessionSidebar.tsx` 视觉语言输出 HTML 原型（可写入本文件 fenced `html` 或另存为 `.ypi/tasks/20260708-100104-修复左侧-session-窄宽换行与-studio-子任务-session-命名/ui-prototype.html`）。原型必须覆盖：

1. 窄宽普通 Session 行：标题、时间、消息数均单行截断，不换行。
2. 窄宽 Studio child Session 行：
   - 标题显示 implementation subtask 标题；
   - badge 保持紧凑；
   - detail 行如 `子任务标题 · run xxxx` 在空间不足时截断。
3. 无 subtask 标题的 Studio child fallback：标题显示 `implementer · 主任务名称` 或等价“角色 + 主任务名称”。
4. hover 操作按钮出现时，文本区域收缩/截断，不导致行高变化。
5. delete confirm / archived session 行在窄宽下不换行、不覆盖。

## 交互要点

- Session 行固定高度保持 54px。
- 标题和元信息均单行；不可因为中文、长英文、长路径、长 run id 自动换行。
- 省略优先级：标题/Studio detail 可被截断；badge、时间、按钮等关键短控件尽量保留。
- tooltip 仍显示完整标题/详情。

## HTML 原型

- 文件：`ui-prototype.html`
- 覆盖：窄宽普通/Studio child/删除确认/hover 操作按钮场景，均保持单行截断、不换行、不改变行高。

## 审批记录

- HTML 原型：已产出。
- 用户/主会话审批：已审批（用户在主会话回复“批准”，随后任务已进入实现）。
