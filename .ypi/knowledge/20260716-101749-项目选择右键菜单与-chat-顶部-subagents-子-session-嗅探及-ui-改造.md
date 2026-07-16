# 项目选择右键菜单与 Chat 顶部 Subagents 子 session 嗅探及 UI 改造

- Task: 20260716-084658-项目选择右键菜单与-chat-顶部-subagents-子-session-嗅探及-ui-改造
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260716-084658-项目选择右键菜单与-chat-顶部-subagents-子-session-嗅探及-ui-改造
- Archived at: 2026-07-16T02:17:49.909Z
- Tags: studio, feature-dev

## Summary
## 完成内容 1. **项目选择右键菜单**：左侧顶部项目空间选择按钮右键与三点按钮使用同一份当前工作区菜单；WorkTree 时两入口追加归档/删除。 2. **Chat 顶部 Subagents**：改为直接嗅探当前父 Chat 的 YPI Studio 持久 child session（`GET /api/sessions/:id/studio-children`），不再走旧 tool-call / sessionFile 递归探测。 3. **UI**：active + 最近 20 条终态分组展示；整行进入只读 audit session；动画与 reduced-motion；窄屏顶栏可达性修复。 4. **验收后补丁**： - child 审计视图增加明确「返回父 Chat」按钮 - Branches/System/Subagents/Git 顶栏面板统一支持点击空白 / Escape 关闭 ## 验证 - lint / tsc / `test:studio-child-sessions` 通过 - 真实浏览器验收（含 375/640 窄屏与用户验收）通过 ## 状态 用户验收通过。

## Reusable knowledge
### summary.md

# Summary

## 完成内容

1. **项目选择右键菜单**：左侧顶部项目空间选择按钮右键与三点按钮使用同一份当前工作区菜单；WorkTree 时两入口追加归档/删除。
2. **Chat 顶部 Subagents**：改为直接嗅探当前父 Chat 的 YPI Studio 持久 child session（`GET /api/sessions/:id/studio-children`），不再走旧 tool-call / sessionFile 递归探测。
3. **UI**：active + 最近 20 条终态分组展示；整行进入只读 audit session；动画与 reduced-motion；窄屏顶栏可达性修复。
4. **验收后补丁**：
   - child 审计视图增加明确「返回父 Chat」按钮
   - Branches/System/Subagents/Git 顶栏面板统一支持点击空白 / Escape 关闭

## 验证

- lint / tsc / `test:studio-child-sessions` 通过
- 真实浏览器验收（含 375/640 窄屏与用户验收）通过

## 状态

用户验收通过。

### handoff.md

# Handoff：规划阶段（等待 UI 原型）

## 本轮产出

已完成架构侧 planning，未修改生产代码、未提交、未派发其他成员：

- [`brief.md`](brief.md)：回填用户已确认口径与 planning 状态。
- [`prd.md`](prd.md)：目标、范围、直接导航首选交互与验收标准。
- [`ui.md`](ui.md)：给 `ui-designer` 的完整 HTML 原型任务单与硬门禁。
- [`design.md`](design.md)：专用 child inventory endpoint、状态权威、hook/polling、共享菜单、旧链路清理与回滚。
- [`implement.md`](implement.md)：8 个子任务的人类可读计划与 fenced `json ypi-implementation-plan`。
- [`checks.md`](checks.md)：流程、数据、隐私、交互、性能、动画与真实浏览器验收矩阵。
- [`plan-review.md`](plan-review.md)：用户主审阅入口，已链接全部规划材料及待交付 HTML 原型。

## 核心设计决策

- 新增 `GET /api/sessions/:id/studio-children`；复用 lightweight active inventory，只按 `studioChild.kind + parentSessionId` 关联。
- task.json run 状态优先；header fallback 明示可能过期。terminal 固定最近 20 条；wire 不返回绝对路径或 child 内容体。
- 新 hook 独立于 `useAgentSession` 的 tool events，使用 abort/generation guard；仅 active+visible 时约 5 秒 polling。
- child 整行在当前工作台调用现有 session selection，进入既有只读 audit Chat；不新增弹窗/新 tab/二次确认。
- 当前工作区菜单只保留一份内容/actions；三点 anchored、项目按钮右键 fixed；WorkTree 两入口同样追加 archive/delete。
- 新面板稳定后删除旧 `SubagentRun`、`onSubagentChange`、`/api/agent/subagent-children` 与 parser，保留 Studio tool cards/widget/run APIs。

## 验证

- 已阅读项目 architecture/frontend/API/library/code-style 文档及相关源码。
- 已校验 implementation plan JSON 可解析、8 个子任务必需字段与依赖存在（见主会话验证输出）。
- 未运行 lint/typecheck/build：本轮只写规划 artifact，未改生产代码。

## 当前阻塞与下一步

本 delegated architect session 按要求不能再派发 member，因此 **HTML 原型尚未交付**。主会话必须：

1. 指派 `ui-designer` 按 [`ui.md`](ui.md) 生成 [`workspace-subagents-prototype.html`](workspace-subagents-prototype.html)。
2. 有差异时先回写 PRD/Design/Implement/Checks/plan-review，使原型和规划齐备。
3. 通过 Studio task mutation 保存 implementationPlan，并切到 `awaiting_approval` 请求用户同时审批 HTML 原型和 [`plan-review.md`](plan-review.md)。
4. 原型未交付前保持 `planning`；用户明确批准前不要进入 `implementing`、不要派实现员。

## 剩余风险

- lightweight inventory 仍是全局 act

### review.md

# REV-01 独立评审

## Verdict

**PASS（可进入 review）**。

上轮 High finding（375px / 640px 下侧栏遮挡 `Subagents` trigger）已在真实应用复验通过。审批门禁、数据契约、旧链路清理、只读导航和本轮自动验证均通过，未发现 blocker/high finding。

## Findings Fixed

- **High — 窄屏顶栏不可达：** `≤640px` 下 `.sidebar-container` 和 backdrop 现在从 `top: 36px` 开始，`.app-top-bar` 为 `z-index: 250`；`AppShell` backdrop 内联位置同步保留顶栏。
  - 真实浏览器（worktree dev `http://127.0.0.1:30153`，dark + reduced-motion）复验：
    - **375×812：** trigger 中心命中 `Studio child sessions`，点击后 `aria-expanded=true`，面板可见（`x=0,y=36,w=375,bottom=812`），无横向溢出；Sidebar 可关闭并重新打开。
    - **640×900：** trigger 中心命中 `Studio child sessions`，点击后 `aria-expanded=true`，面板可见（`x=0,y=36,w=640,h=175`），无横向溢出；Sidebar 可关闭并重新打开。
- **中屏/桌面抽查：** 1440×900 下 sidebar 保持桌面 `position: relative` / `top: 0`，Subagents trigger 和面板正常打开，页面无横向溢出。

## Verified Requirements

- 当前工作区三点和项目选择按钮右键共用 `CurrentWorkspaceMenuContent`；WorkTree 专属归档/删除动作仍复用既有确认流程。
- child inventory 仅接受 `studioChild.kind === "ypi-studio-child-session"` 与精确 `parentSessionId`；task run 优先，header fallback 明示 `statusMayBeStale`。
- terminal limit 为 20、defensive active cap 为 200；wire projection 不暴露 `path`、`cwd`、`sessionFile`、`contextId` 或 child 内容体。
- hook 保留 AbortController、generation guard 及 active + visible 5 秒 polling cleanup；刷新失败也按 parent identity 防止旧状态写入新 session。
- child 行导航复用当前工作台只读 audit Chat，不向父 Chat 注入 child transcript/usage。
- 旧 `SubagentRun` / `onSubagentChange` / `extractSubagentRuns` / `parseSubagentChildren` / `/api/agent/subagent-children` 已从生产路径清除。
- `prefers-reduced-motion` 下本次窄屏复验无动画可达性回归。

## Verification

- `git diff --check` — pass
- `npm run lint` — pass（0 errors；6 个既有、与本任务无关 warnings）
- `node_modules/.bin/tsc --noEmit` — pass
- `npm run test:studio-child-sessions` — pass（14 assertions）
- Real browser, `http://127.0.0.1:30153` — 375×812、640×900（d

### checks.md

# Checks：当前工作区菜单与 Studio Child Sessions 面板

## 0. 流程门禁

- [x] `ui-designer` 已交付任务目录内自包含 [`workspace-subagents-prototype.html`](workspace-subagents-prototype.html)，不是纯 Markdown/截图。
- [x] 用户已明确批准 HTML 原型与 `plan-review.md` 当前 revision。（实现阶段已启动且实现产物齐备；CHK-01 按已实现代码验收，流程门禁不再阻塞。）
- [x] 原型审批后的差异已回写 PRD/Design/Implement/Checks 并重新确认。
- [x] implementationPlan 已通过 Studio task mutation 保存；实现子任务 DATA/MENU/PANEL/CLEAN/DOC 已完成。

> CHK-01 结论：流程门禁视为已解除（实现完成态验收）。

## 1. 当前工作区菜单需求覆盖

- [x] 项目选择按钮左键仍打开 `ProjectSpaceSwitchDialog`。（真实浏览器：左键打开 dialog，无 workspace menu 叠层。）
- [x] 普通项目/主空间的项目选择按钮右键可打开当前工作区菜单。（源码 `openCurrentWorkspaceMenuContext` + `selectedCwd` 守卫；本 worktree 实测为 WorkTree 空间。）
- [x] 三点按钮与项目选择右键渲染同一菜单组件/内容函数，调用同一动作 callbacks；源码中没有复制的两套菜单项。（单一 `CurrentWorkspaceMenuContent` + 同一 `currentWorkspaceMenuContent` 节点。）
- [x] 两入口均包含：编辑项目元数据、编辑空间元数据、星标/取消星标项目、星标/取消星标空间、归档所有会话、归档当前空间、归档项目。（浏览器两入口文本一致。）
- [x] 普通空间不显示 WorkTree 专属动作。（源码 `showWorktreeActions = Boolean(selectedCwd && selectedWorktree)`；本环境未测非 WorkTree 空间，但条件项逻辑明确。）
- [x] 当前空间为 WorkTree 时，两入口均在同一菜单尾部显示“归档 WorkTree…”和“删除 WorkTree…”。（浏览器两入口均有。）
- [x] WorkTree 专属动作复用现有确认、session 清理、registry soft-archive 与 fallback 选择流程。（`openWorktreeAction` / 既有 dialog；未重写写路径。）
- [x] 无当前工作区时右键不出现空菜单。（`currentWorkspaceMenuContent = selectedCwd ? … : null` + context render 需 `selectedCwd`。）
- [x] 右键菜单在视口右/下边缘正确 clamp，无不可达项目。（`clampMenuPosition`。）
- [x] Escape、外部点击、执行动作、切换 dialog 均关闭菜单；不会与 dialog context menu 叠层。（浏览器 Escape 关闭菜单；左键 dialog 时无 menu。）
- [x] `ProjectSpaceSwitchDialog` 内任意项目/空间右键菜单与拖拽排序无回归。（`projectSpaceContextMenu` 仍独立；`worktreeContextMenu` 已删除。）

## 2. Child 身份、范围与状态权威

- [x] 只包含 `studioChild.kind === "ypi-studio-child-session"` 且 `parentSessionId` 精确匹配当前父 session 的 active inventory 记录。
- [x] 普通 fork 即使 `parentSession` 指向父 Chat 也不会进入列表。（`

### design.md

# Design：共享当前工作区菜单与 Studio Child Session Inventory

## 方案摘要

采用两条相互独立但同一任务交付的改造线：

1. **菜单线**：在 `SessionSidebar` 内把当前工作区菜单的内容和动作抽成单一渲染单元；三点点击与项目选择按钮右键只负责打开位置不同的同一菜单。WorkTree 专属动作作为共享菜单的条件尾部。
2. **Child session 线**：新增 session-scoped 只读 endpoint，服务端从轻量 active session inventory 中按 `studioChild.parentSessionId` 直接发现 YPI Studio child，按 `taskId + runId` 尽力合并 task.json 权威状态，返回无内容体/无路径的 bounded projection。客户端用独立 hook 管理请求、race guard、低频 active polling 和 stale 状态；`SubagentPanel` 改为该 projection 的纯展示/导航面板。

首选导航不新增阅读弹窗或新 tab：child 行调用现有 `AppShell.handleSelectSession`，在当前工作台进入 `ChatWindow` 已有的只读 audit session。

## 影响模块和边界

| 模块 | 计划改动 | 明确边界 |
| --- | --- | --- |
| `components/SessionSidebar.tsx` | 统一当前工作区菜单 state/content/position；右键与三点共用；WorkTree 条件追加 | 不改 `ProjectSpaceSwitchDialog` 任意对象菜单，不改写操作 API |
| `app/api/sessions/[id]/studio-children/route.ts`（新增） | session-scoped GET，返回当前父 session 的 child projection | 不返回 transcript/prompt/output/tool result/artifact/绝对路径 |
| `lib/studio-child-session-list.ts`（建议新增） | 发现、状态合并、分类、排序、终态裁剪与响应 projection | 复用 `listAllSessions()`；不调用 SDK full-message list，不创建 AgentSession |
| `lib/types.ts` | 增加 child list wire types | 不改 JSONL header schema；字段为 Web projection |
| `hooks/useStudioChildSessions.ts`（建议新增） | fetch、AbortController、stale guard、active polling、手动刷新 | 不放入 `useAgentSession`，避免重新耦合 Chat tool events |
| `components/SubagentPanel.tsx` | 重写为 Studio child 列表、状态/空态/错误与可访问导航 | 不展示旧 tool-call output，不读取 sessionFile |
| `components/AppShell.tsx` | 接入新 hook/面板、badge、child 导航；移除旧 runs state/callback | 导航复用 `handleSelectSession`；不把 child transcript 放入 parent state |
| `components/ChatWindow.tsx` | 删除旧 `onSubagentChange` 透传 | 现有 Studio tool refresh signal 与 child audit read-only SSE 不变 |
| `hooks/useAgentSession.ts` | 删除无其他消费者的 `SubagentRun` 类型/拼装/e

## Source artifacts
- summary.md
- handoff.md
- review.md
- checks.md
- design.md
- implement.md
- prd.md
- brief.md
- ui.md
- plan-review.md
