# 项目工作区菜单与 Studio Child Sessions 改造计划审批书

## 当前审批结论

本计划将完成两项改造：

1. 左侧顶部项目空间选择按钮右键与旁边三点按钮使用同一份“当前工作区菜单”；WorkTree 时两入口都追加归档/删除专属动作。
2. Chat 顶部 `Subagents` 不再解析旧 tool call/sessionFile，而是直接发现当前父 Chat 的持久 YPI Studio child sessions，显示全部 active + 最近 20 条终态，并允许点击整行在当前工作台进入现有只读 audit session。

**当前可以批准切到 `awaiting_approval`。** HTML 原型硬门禁已由 `ui-designer` 交付：任务目录内已生成自包含 HTML 原型。请主会话/用户同时审批原型与本计划当前 revision。

- 计划中的 HTML 原型：[workspace-subagents-prototype.html](workspace-subagents-prototype.html)
- UI 设计任务单与交付状态：[ui.md](ui.md)

## 已确认产品决策

- child 范围仅限 `studioChild.kind === "ypi-studio-child-session"` 且 `parentSessionId` 精确匹配；排除普通 fork 和旧 pi-subagents 推测关联。
- 两个当前工作区菜单触发器完全同源；WorkTree 条件追加专属项。
- 面板显示全部 active child + bounded 最近终态（计划固定 20 条）。
- child 行主行为是直接导航；首选当前 Web 工作台内的既有只读 audit Chat，不以内联摘要或隐藏次级按钮替代。
- 该导航与 Sidebar session 选择同类且不写数据，不增加二次确认；通过整行 button/link、进入箭头与“只读”文案降低误操作。
- 动画为 160–220ms、低频 active 呼吸、一次性终态反馈；reduced-motion 全静态。

## PRD 摘要

- 统一菜单入口与动作，保留左键项目切换和 dialog 内任意对象右键语义。
- child 身份只认持久 JSONL header 高置信关系；task.json run 状态优先，header fallback 明示可能过期。
- 覆盖 loading、empty、waiting、active、terminal、stale/error 和截断状态。
- 点击/键盘激活 child 行后，当前工作台切到对应 child id，复用已有只读 Chat/SSE 边界。
- 不把 child transcript、tool result、路径或 usage detail 注入父 Chat。

详见 [PRD](prd.md)。

## UI 摘要

- 原型需同时演示普通/WorkTree 共享菜单和 Chat 顶栏 child panel。
- 面板建议顺序：等待用户 → 运行中/排队 → 最近完成；整行明确“进入只读审计会话”。
- 覆盖 1440/1024/900/640/375px、浅深主题、键盘、200% zoom、内部滚动和 reduced-motion。
- HTML 必须位于任务目录，纯 Markdown/截图不能满足门禁。

详见 [UI 任务单](ui.md)；计划原型文件为 [workspace-subagents-prototype.html](workspace-subagents-prototype.html)。

## Design 摘要

- 新增专用只读 `GET /api/sessions/:id/studio-children`，避免顶栏耦合项目空间 sessions 完整响应。
- endpoint 复用 lightweight active inventory；按 `studioChild.kind + parentSessionId` 筛选，按 task 去重合并 run 权威状态。
- wire allowlist 不含 path/cwd/sessionFile/contextId/prompt/output/summary/error/transcript/artifact；terminal 固定最近 20 条，active 有高位防御 cap 和显式截断。
- 新 hook 负责 AbortController + generation guard、stale/error、事件刷新和 active+visible 约 5 秒 polling。
- 当前工作区菜单 state 支持 anchored/context 两种位置，但只渲染一份内容和 callbacks。
- 新面板稳定后删除旧 `SubagentRun`、`onSubagentChange`、`/api/agent/subagent-children` 与 parser；保留 Studio tool cards/widget/run API。

详见 [Technical Design](design.md)。

## Implement 摘要

计划包含 8 个子任务：

1. `UI-01`：HTML 原型交付和用户审批（硬依赖）。
2. `DATA-01`：child inventory route/helper/wire/test。
3. `MENU-01`：共享当前工作区菜单。
4. `PANEL-01`：hook、面板、badge、当前工作台导航与动画。
5. `CLEAN-01`：移除旧 tool-call/sessionFile 探测链路。
6. `DOC-01`：同步 architecture/frontend/API/library/standards 文档。
7. `CHK-01`：自动验证与真实浏览器矩阵。
8. `REV-01`：checker 独立评审。

`DATA-01` 与 `MENU-01` 可在原型审批后并行，其余按依赖串行。机器可读 schemaVersion 2 Implementation Plan 已包含在 [Implement](implement.md)，但尚未保存到 `task.json`，因为原型门禁未解除。

## Checks 摘要

- 比较两个菜单入口是否真正同源，并验证 WorkTree 能力无回退。
- 校验 child 高置信筛选、task 状态权威、header stale fallback、稳定排序/裁剪与 wire 隐私。
- 验证快速 session 切换 race、visibility polling cleanup、stale/error 保留旧数据。
- 验证整行鼠标/键盘导航、URL child id、只读 Chat/SSE、父 Chat 无 child 注入。
- 覆盖 375–1440px、200% zoom、浅深主题、一次性动画与 reduced-motion。
- 自动命令：lint、typecheck、`test:studio-child-sessions`、session title、Studio SDK runner；真实浏览器证据不可由 HTML 原型替代。

详见 [Checks](checks.md)。

## 用户审批前需完成

1. 主会话指派 `ui-designer`，生成并检查 [workspace-subagents-prototype.html](workspace-subagents-prototype.html)。
2. `ui-designer` 在 [ui.md](ui.md) 回填关键设计决策和原型交付状态。
3. 如原型与当前 PRD/Design 有差异，架构师先同步所有规划产物。
4. 原型和规划齐备后，主会话保存 implementationPlan，并按流程进入 `awaiting_approval`。
5. 在 `awaiting_approval` 请求用户同时批准共享菜单视觉层级、面板分组、整行当前工作台导航、只读提示、响应式、动画及完整计划；没有明确批准不得进入实现。

## 相关材料

- [Brief](brief.md)
- [PRD](prd.md)
- [UI 门禁与原型任务单](ui.md)
- [HTML 原型（待 ui-designer 交付）](workspace-subagents-prototype.html)
- [Technical Design](design.md)
- [Implementation Plan](implement.md)
- [Checks](checks.md)

## 当前状态

- Brief / PRD / Design / Implement / Checks / plan-review：已完成架构侧内容。
- HTML 原型：**已交付于任务目录 `workspace-subagents-prototype.html`**。
- 用户计划/原型审批：待取得。
- task implementationPlan：已生成。
- 推荐 workflow 状态：可以 transition 至 `awaiting_approval`。
- 实现许可：未授予（等待审批中）。
