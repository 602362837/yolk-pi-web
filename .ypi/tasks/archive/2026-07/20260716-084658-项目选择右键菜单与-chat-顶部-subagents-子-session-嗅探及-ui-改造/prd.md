# PRD：当前工作区右键菜单与 YPI Studio Child Sessions 面板

## 目标与背景

当前左侧顶部项目空间选择按钮的右键行为与旁边三点菜单分裂：普通项目无响应，WorkTree 只出现旧的归档/删除菜单。Chat 顶部 `Subagents` 又依赖旧 `subagent` / `trellis_subagent` tool call、tool result 与 `sessionFile` 递归解析，无法诚实代表已经持久化为独立 JSONL 的 YPI Studio child session。

本任务统一当前工作区菜单入口，并将 `Subagents` 改造成当前父 Chat 的 YPI Studio child audit session 发现与导航面板。用户无需理解 tool-call 解析过程，即可查看正在执行、等待用户、已结束的 Studio child，并直接进入其只读审计会话。

## 用户价值

- 在项目空间选择入口上右键即可获得与三点按钮完全一致的当前工作区操作，不再记忆两套入口。
- 顶栏展示真实持久化 child session，而非某一轮 tool call 的临时拼装结果。
- 可以从 child 列表直接进入现有只读 audit session，查看完整会话，且不会把 child 内容注入父 Chat。
- loading、空态、等待用户、失败、数据可能过期等状态均有明确文字，不靠颜色猜测。

## 范围内

### 1. 当前工作区菜单

1. 左侧顶部项目空间选择按钮保留左键打开 `ProjectSpaceSwitchDialog`。
2. 当存在当前工作区时，按钮右键打开“当前工作区菜单”。
3. 右键菜单与旁边三点按钮必须渲染同一菜单内容、调用同一动作回调，不能复制两套菜单项。
4. 共享菜单保留现有项目/空间元数据编辑、项目/空间星标、归档所有会话、归档当前空间、归档项目。
5. 当前空间为 WorkTree 时，两个触发器的共享菜单末尾都追加“归档 WorkTree…”和“删除 WorkTree…”专属项；危险动作继续沿用现有确认流程。
6. 没有当前工作区时，右键不打开空菜单；左键选择流程不变。
7. 不改变 `ProjectSpaceSwitchDialog` 内针对任意项目/空间的上下文菜单语义。

### 2. Subagents child session 发现

1. “子 session”仅指 header 满足 `studioChild.kind === "ypi-studio-child-session"` 且 `studioChild.parentSessionId === 当前选中父 session id` 的 YPI Studio child audit session。
2. 排除普通 fork、没有高置信 parent 关联的 session、旧 pi-subagents / Trellis subagent tool-call 记录。
3. 面板显示当前父 Chat 的全部 active child，并显示最近 20 条终态 child；终态上限为固定服务端常量，响应返回截断信息。
4. active 状态至少覆盖 `queued`、`running`、`waiting_for_user`；终态至少覆盖 `succeeded`、`failed`、`cancelled`、`runtime_lost`。
5. task/run 状态优先读取 `.ypi/tasks/<task>/task.json` 对应 run；无法解析时允许降级到 child header，但必须标记“状态可能过期”，不得伪装为权威实时状态。
6. 标题优先使用现有 `studioChildDisplay`：`subtaskId · subtaskTitle`，无 subtask 时使用 `member · taskTitle`；保留 member、状态、时间与必要的短标识作为次要信息。
7. 不读取 child transcript/tool result 来识别 child 或拼装列表。

### 3. 面板与直接进入 child audit session

1. 顶栏 `Subagents` 按钮在当前选中父 session 变化后加载对应 child 列表；不存在已保存父 session 时显示解释性空态。
2. 面板覆盖首次 loading、empty、active、waiting_for_user、succeeded、failed、cancelled/runtime_lost、刷新失败且保留旧数据（stale）等状态。
3. 首选交互：**点击整条 child 行，在当前 Web 工作台内切换到该 child audit session**，复用现有 `AppShell.handleSelectSession`、URL `?session=<childId>` 与 `ChatWindow` 只读审计模式；面板随导航关闭。
4. 行必须是可聚焦的 button/link 语义，Enter/Space 与点击一致，并用“进入只读审计会话”文案或箭头明确导航后果。
5. 该导航是只读且与侧边栏选择 session 同类，不增加二次确认；用户未发送草稿的处理沿用现有 session 切换行为，不在本任务引入新的草稿持久化策略。
6. 不使用“整行只展开摘要”替代导航，也不把导航降级成隐藏的次级动作。
7. 选中 child audit session 后，Chat 继续执行现有只读限制；不允许普通发送、Studio 编排或 Browser Share action 注入。

### 4. 刷新、动画与可访问性

1. Session 切换时中止旧请求或忽略旧响应，旧父 session 数据不得覆盖新 Chat。
2. 初次选择、手动刷新、现有 Studio/session-list 刷新信号触发重载；仅在存在 active child 且页面可见时允许约 5 秒低频 polling，终态/隐藏页面停止轮询。
3. 面板与列表过渡为 160–220ms；建议 180ms。
4. active 指示点可低频呼吸；失败/完成仅在状态发生变化时播放一次有限反馈，不因每次 polling 重放。
5. `prefers-reduced-motion: reduce` 下取消呼吸、位移、闪烁与过渡，状态仍通过图标和文字可辨识。
6. 状态不能仅靠颜色表达；支持 Escape/外部点击关闭、合理焦点顺序、200% 缩放和窄屏内部滚动。

## 范围外

- 不改变 YPI Studio child runner、JSONL header schema、task workflow、approval gate、child guard 或只读约束。
- 不支持普通 fork 或旧 pi-subagents child 的推测关联。
- 不把 transcript、prompt、output、tool result、artifact、累计 usage 或 tps 注入父 Chat 或列表 API。
- 不重做 Sidebar 已有的父 session → Studio child audit row。
- 不改变项目切换弹窗内任意对象的右键菜单、拖拽排序与选择行为。
- 不新增 child session 弹窗阅读器，也不新增外部/新 tab 路由；首版使用当前工作台现有 session 导航。
- 不在规划审批前修改生产代码。

## 验收标准

1. 普通项目、主空间和 WorkTree 上，项目选择按钮右键均打开与三点按钮同源的当前工作区菜单。
2. WorkTree 的两个触发器均包含专属归档/删除项；普通空间均不包含。
3. 当前父 session 的 child 列表只包含高置信 YPI Studio children，active 全部可见，终态最多 20 条并有截断提示。
4. 面板不依赖旧 `SubagentRun` tool-event 拼装、`sessionFile` 或 `/api/agent/subagent-children`。
5. 点击/键盘激活 child 行后，当前工作台切换到正确 child id，URL 更新，Chat 显示只读 audit session，父 Chat 内容没有被修改或混入 child 消息。
6. 快速切换两个父 session 不发生 stale response 覆盖；active polling 在无 active child 或页面隐藏时停止。
7. 所有状态有图标/文字，刷新失败能保留旧数据并标记可能过期；reduced-motion 下完全静态。
8. 获批 HTML 原型、lint、typecheck、聚焦数据测试和真实浏览器人工验收均通过。

## 已确认产品决策

- child 范围仅限 YPI Studio 持久 child session。
- 共享菜单在 WorkTree 时追加专属动作。
- 列表范围为全部 active + bounded 最近终态。
- 行点击必须直接进入 child session；首选当前 Web 工作台的现有只读 audit session。
- 动画采用 160–220ms、低频 active 指示、有限终态反馈及 reduced-motion 全静态降级。

## 未决问题

产品口径已稳定。剩余阻塞不是产品决策，而是流程门禁：主会话必须指派 `ui-designer` 交付并由用户审批任务目录内的自包含 HTML 原型后，才能进入实现。
