# Brief：项目选择右键菜单与 Chat 顶部 Subagents 子 Session 改造

## 用户目标

1. 左侧顶部“项目空间选择”按钮支持右键，并呈现与旁边三点按钮一致的当前工作区操作菜单。
2. 重做 Chat 顶部 `Subagents`：不再从旧 `subagent` / `trellis_subagent` tool call、tool result 和 `sessionFile` 递归解析运行记录，改为直接发现当前父 Chat 的持久 child session。
3. 优化 Subagents 面板的信息层级、视觉与交互，并增加克制、可降级的动画。

## 现状证据

### 项目选择右键

- `components/SessionSidebar.tsx` 中项目空间选择按钮已有 `onContextMenu`，但仅当当前空间是 WorkTree 时打开旧的 `worktreeContextMenu`，菜单只有“归档 WorkTree / 删除 WorkTree”。普通项目右键无响应。
- 同文件下方三点按钮由 `workspaceMenuOpen` 控制，提供当前项目/空间元数据、星标、归档所有会话、归档当前空间、归档项目等操作。
- `ProjectSpaceSwitchDialog` 内项目卡片和空间行已有另一套目标对象右键菜单；本需求应只调整左侧顶部“当前工作区”入口，不改变弹窗内“任意对象”右键语义。
- 推荐不要复制菜单项和写操作：抽出/复用同一份当前工作区菜单内容，让三点点击和项目选择按钮右键只是两个触发器，避免以后动作漂移。

### Chat 顶部 Subagents

- `components/AppShell.tsx` 的 `Subagents` 顶栏按钮读取 `ChatWindow -> useAgentSession -> onSubagentChange` 上抛的 `SubagentRun[]`。
- `hooks/useAgentSession.ts` 目前只监听 `subagent` / `trellis_subagent` 的 tool execution 事件，通过 tool args/result 拼装运行态；不识别 `ypi_studio_subagent` 的持久 child session 作为该面板数据源。
- `components/SubagentPanel.tsx` 展开一条旧 run 后，会调用 `GET /api/agent/subagent-children?sessionFile=...`；该 route 再由 `lib/parse-subagent-children.ts` 全量读取 child JSONL、解析嵌套 tool call。这正是用户要求淘汰的旧探测路径。
- 新 YPI Studio SDK 模型已采用“一次 run 一个持久 child JSONL session”。child header 有 `studioChild.kind`、`parentSessionId`、`taskId`、`runId`、`member`、`subtaskId`、status/time 等关联字段；`SessionInfo` 另有 `studioChildDisplay` 标题投影。
- `GET /api/projects/:projectId/spaces/:spaceId/sessions` 已扫描 active session inventory，并按 `studioChild.parentSessionId` 生成 `studioChildrenByParentSessionId`，证明“按父 session 直接发现 child”已有可靠数据基础；但该 route 属于 Sidebar/project-space 热路径，不宜让顶栏组件自行耦合其完整响应。
- child JSONL 是审计、真实对话和 provider affinity 载体；`.ypi/tasks/<task>/task.json` 仍是 workflow/run 状态权威。面板不得把 child transcript、tool result 或累计 usage 注入父 Chat。

## 推荐范围

### 范围内

- 顶部项目选择按钮在已有当前工作区时，右键打开与三点按钮同源、同内容、同写操作的菜单。
- 保留项目切换按钮左键打开 `ProjectSpaceSwitchDialog`。
- 将 Chat 顶部 Subagents 的数据模型改为“当前选中父 session 的直接 YPI Studio child sessions”。
- child 列表以 `studioChild.parentSessionId === selectedSession.id` 为高置信关系；默认 active 优先，其后显示最近终态记录，并使用 `studioChildDisplay` 展示 task/subtask 标题。
- 面板覆盖 loading、empty、active、waiting_for_user、succeeded、failed/cancelled、stale/error 等诚实状态；状态不能仅靠颜色表达。
- 复用现有 child audit session 只读能力；是否提供“打开审计会话”入口由 UI 原型确认。
- 动画只用于打开/关闭、列表增删/状态变化和 active 指示；必须支持 `prefers-reduced-motion` 静态降级，不使用持续高频 shimmer。
- 删除旧顶栏探测链路后，清理无调用方的 `SubagentRun` 拼装、`/api/agent/subagent-children` 与 `parse-subagent-children`，前提是全仓搜索确认没有其他消费者。
- 同步更新 frontend/API/library/architecture 文档；若新增或移除 API route，更新 `docs/modules/api.md`。

### 范围外

- 不改变 YPI Studio child runner、child JSONL header、task workflow、approval gate 或 child 只读约束。
- 不把普通 fork session 当成 subagent。
- 不从 transcript 文本、tool-call 文案、累计 token/tps 猜测 child 身份或状态。
- 不重做 Sidebar 中父 session 下的 Studio child audit rows。
- 不修改项目切换弹窗内针对任意项目/空间的上下文菜单与排序。
- 不在本阶段直接修改生产代码。

## 推荐数据边界

- 规划确定新增 session-scoped、只读、bounded 的专用 `GET /api/sessions/:id/studio-children`，不扩张单 session detail；服务端复用 lightweight active session inventory 和现有 `studioChildDisplay` 投影。
- 返回内容限于 child session id、关联 metadata、display title、created/modified/messageCount 和必要的状态时间；禁止 transcript、prompt、output、tool result、artifact、本机绝对路径。
- 当前父 session 变化时必须中止/忽略旧请求，避免旧 child 列表覆盖新 Chat。
- 刷新复用现有 session-list/Studio 变更信号；仅在存在 active children 时允许低频 polling 或事件触发刷新，不新增无界全局高频扫描。

## UI 原型门禁

本任务同时改变可见菜单交互、Chat 顶栏面板、信息结构和动画，明确触发 UI 原型硬门禁。下一步必须由主会话指派 `ui-designer`，基于当前 `SessionSidebar`、`SubagentPanel`、`SessionStatsChips` 和顶栏 action-tag 风格产出任务目录内自包含 HTML 原型；`ui.md` 纯 Markdown 不能替代。用户批准 HTML 原型和完整计划前不得进入实现。

## 已确认产品口径

1. child 仅指带 `studioChild.kind === "ypi-studio-child-session"` 且 parent id 精确匹配的 YPI Studio child；排除普通 fork 与旧 pi-subagents 推测关联。
2. 面板显示当前父 Chat 的全部 active child + 最近终态 child；规划固定终态返回最近 20 条，并保留防御性 active hard cap/显式截断。
3. child 行必须直接进入该 child session。首选交互为复用当前 Web 工作台的 `handleSelectSession` 与既有只读 audit Chat；整行是导航，不再以内联摘要展开作为主行为，也不增加写操作确认框。
4. 项目选择按钮右键与三点按钮渲染完全同源菜单；当前空间为 WorkTree 时，两入口共享菜单都追加归档/删除 WorkTree 专属项。
5. 动画采用 160–220ms 面板/列表过渡、低频 active 呼吸点、失败/完成一次有限反馈；`prefers-reduced-motion` 全静态。

## 当前流程状态与下一步

任务已进入 `planning`，架构侧 PRD / UI brief / Design / Implement（含机器可读 implementation plan）/ Checks / plan-review 已补齐。当前唯一硬阻塞是 HTML 原型尚未交付：本 delegated architect session 按约束不能再派发 member，主会话必须指派 `ui-designer` 产出 `workspace-subagents-prototype.html`。HTML 原型交付且架构计划同步齐备前保持 `planning`；齐备后由主会话保存 implementationPlan 并切到 `awaiting_approval` 请求用户同时审批原型与计划。用户批准前不得进入 `implementing`。
