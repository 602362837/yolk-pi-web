# Brief

## 问题

YPI Studio 已在任务详情中提供 `plan-review.md` 的专用审批预览，但 session 级任务浮窗在任务进入 `awaiting_approval` 后仍只有“打开任务详情”入口。用户需要先展开右侧 Studio 面板、定位审批 Tab，路径过长，也不利于理解当前真正需要审阅的材料。

## 目标

- 主任务处于 `awaiting_approval` 时，在展开的任务浮窗卡片中显示「计划审批书」入口。
- 点击入口后，以模态弹窗渲染预览该任务的 `plan-review.md`。
- 改进项处于 `waiting_plan_approval` 时提供等价入口，并读取该改进项目录内的 `plan-review.md`。
- 预览是只读审阅行为，不写审批状态、不绕过聊天中的明确批准门禁。

## 约束

- 优先复用现有 `MarkdownBody`、task-local files API、任务相对链接解析和现有主题变量。
- 不把 artifact 正文加入 session widget 轻量投影；正文只在用户点击后按需读取。
- 保持浮窗 360px 桌面宽度、拖拽/收纳行为和移动端底部面板不变。
- 任务浮窗仅展示绑定当前 session 的任务；不得扩大任务可见范围。
- 本阶段只做规划和 HTML 原型，不修改生产代码，不进入 `implementing`。

## 调研结论

- 浮窗：`components/YpiStudioSessionWidget.tsx`；`TaskCard` 目前只有详情箭头，没有审批材料入口。
- 宿主：`components/AppShell.tsx` 已持有 `activeCwd`、`handleOpenFile` 和任务绑定投影。
- 审批预览：`components/YpiStudioPanel.tsx` 的 `TaskApprovalTab` 已用 `MarkdownBody` 渲染 `plan-review.md`，并明确“预览不会自动批准”。
- 读取 API：`GET /api/studio/tasks/[taskKey]/files?cwd=...&path=...&mode=read[&improvementId=...]`；服务端拒绝 scheme、绝对路径、`..`、目录和符号链接逃逸。
- HTML 相对链接预览继续使用同一路由 `mode=preview` 的 CSP sandbox 响应。
- widget 投影已包含主任务 `status`，以及改进项的 `id/displayId/status`，足以决定入口显隐，无需下发 artifact 正文。

## 成功标准

用户看到等待审批状态后，可从浮窗一击打开可读、可关闭、支持长内容滚动的计划审批书；关闭后仍停留在当前聊天和浮窗上下文，并继续通过绑定聊天明确批准或提出修改。
