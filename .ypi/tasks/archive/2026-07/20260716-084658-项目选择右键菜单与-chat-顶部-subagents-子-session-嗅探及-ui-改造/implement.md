# Implement：当前工作区菜单与 Studio Child Sessions 面板

## 实现前置门禁

1. 主会话指派 `ui-designer`，交付并回填 [`workspace-subagents-prototype.html`](workspace-subagents-prototype.html)。
2. 若原型改变当前方案，架构师先同步 PRD/Design/Implement/Checks/plan-review，使计划与原型齐备。
3. 主会话通过 Studio task mutation 保存本文件的 implementationPlan，并切到 `awaiting_approval` 请求用户同时审批 HTML 原型与 [`plan-review.md`](plan-review.md) 当前 revision。
4. 用户批准前不得 claim/dispatch 实现子任务或进入 `implementing`；本 architect delegated session 只产出规划，不修改生产代码、不直接手改 task 状态。

## 需先阅读

所有实现员/检查员：

- `AGENTS.md`
- `docs/architecture/overview.md`
- `docs/modules/frontend.md`
- `docs/modules/api.md`
- `docs/modules/library.md`
- `docs/standards/code-style.md`
- 本任务获批的 `brief.md`、`prd.md`、`ui.md`、HTML 原型、`design.md`、`checks.md`、`plan-review.md`

按子任务再阅读：

- 菜单：`components/SessionSidebar.tsx`、`components/ProjectSpaceSwitchDialog.tsx`、`lib/project-display.ts`
- 数据：`lib/session-reader.ts`、`lib/session-header-metadata.ts`、`lib/ypi-studio-tasks.ts`、`lib/ypi-studio-types.ts`、`lib/types.ts`、`app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts`
- UI/导航：`components/AppShell.tsx`、`components/SubagentPanel.tsx`、`components/ChatWindow.tsx`、`components/SessionStatsChips.tsx`、`hooks/useAgentSession.ts`、`app/globals.css`
- 旧链路：`app/api/agent/subagent-children/route.ts`、`lib/parse-subagent-children.ts`

## 人类可读子任务表

| ID | Phase | Order | 子任务 | 依赖 | 主要文件 | 可并行 |
| --- | --- | ---: | --- | --- | --- | --- |
| UI-01 | UI | 1 | UI 设计员交付并取得 HTML 原型审批 | 无 | task `ui.md`, `workspace-subagents-prototype.html`, `plan-review.md` | 否 |
| DATA-01 | Implement | 2 | 实现 session-scoped child inventory、wire contract 与聚焦测试 | UI-01 | 新 route/helper、`lib/types.ts`、tests/package | 可与 MENU-01 并行 |
| MENU-01 | Implement | 2 | 统一项目选择右键与三点的当前工作区菜单 | UI-01 | `components/SessionSidebar.tsx`, CSS | 可与 DATA-01 并行 |
| PANEL-01 | Implement | 3 | 实现 child fetch hook、面板、badge、直接进入 audit session 与动画 | DATA-01, UI-01 | hook、`SubagentPanel`, `AppShell`, CSS | 否 |
| CLEAN-01 | Implement | 4 | 删除旧 tool-call/sessionFile 递归探测链路 | PANEL-01 | `useAgentSession`, `ChatWindow`, 旧 route/parser | 否 |
| DOC-01 | Docs | 5 | 更新 architecture/frontend/API/library/standards 文档 | MENU-01, CLEAN-01 | `docs/**` | 否 |
| CHK-01 | Checks | 6 | 自动验证与真实浏览器矩阵验收 | DATA-01, MENU-01, PANEL-01, CLEAN-01, DOC-01 | tests/checks/diff | 否 |
| REV-01 | Review | 7 | checker 独立检查需求、原型、数据边界与回归 | CHK-01 | 全部改动与证据 | 否 |

## 执行步骤

### 1. UI-01：先完成硬门禁

- `ui-designer` 按 `ui.md` 产出自包含 HTML，覆盖共享菜单、WorkTree 条件项、所有 child 状态、整行当前工作台导航、只读 audit 示例、响应式、焦点和 reduced-motion。
- 用户审批后在 `ui.md` 与 `plan-review.md` 记录审批范围；若原型改变信息层级/导航方式，先回写 PRD/Design/Implement/Checks 再审批，不能让实现自行取舍。

### 2. DATA-01：建立最小只读数据契约

- 新增 `GET /api/sessions/[id]/studio-children`，route 保持薄层。
- 新增 server helper，复用 `listAllSessions({ includeStudioChildren: true, includeStudioChildDisplay: true })`，只按 `studioChild.kind + parentSessionId` 关联。
- task run 状态优先，header fallback 明示 stale；按 task 去重读取，单 child/task 错误隔离。
- 服务端完成状态归一化、稳定排序、terminal 20 条裁剪、防御 active cap 与 counts/limits 投影。
- wire 不返回 path/cwd/sessionFile/contextId/content/summary/error；响应 `no-store`。
- 增加纯投影/排序测试并加入 package script，至少覆盖关联排除、状态权威、fallback stale、排序/裁剪、隐私字段。

### 3. MENU-01：共享菜单而非复制 JSX

- 把现有三点菜单内容及 callbacks 抽成单一 `CurrentWorkspaceMenu` 或等价局部组件。
- state 同时支持 anchored 与 fixed context position；右键做 viewport clamp。
- 两个触发器均展示同一项目/空间动作；WorkTree 时在共享尾部追加 archive/delete 并复用 `openWorktreeAction`。
- 删除顶部专用 `worktreeContextMenu`，保留 dialog 的 `projectSpaceContextMenu`。
- 统一 Escape/outside/selection close，防止菜单叠层；左键项目切换不变。

### 4. PANEL-01：独立数据 hook 与直接导航

- 新增 `useStudioChildSessions`：selected id keyed AbortController + generation guard；initial/error/stale/retry；页面可见且 active 时 5 秒 polling；hidden/terminal/unmount 清理。
- `AppShell` 提供 selected session、refresh signal 与 `handleOpenStudioChildSession`；不再从 ChatWindow接收 run 拼装。
- 重写 `SubagentPanel` 为 projection 展示；严格按获批原型呈现 waiting/active/recent terminal、loading/empty/stale/error、截断提示。
- child row 使用 button/link 语义，激活后关闭 panel，并用父 session workspace context + child projection 构造最小 `SessionInfo` 调用现有 `handleSelectSession`。
- 顶栏 badge 使用响应 child counts；状态变化动画通过 previous status map 控制，initial/poll 同状态不重播。
- CSS 采用 160–220ms、低频 active 点、有限 terminal feedback；reduced-motion 全静态。

### 5. CLEAN-01：全仓确认后删除旧探测

- `rg` 确认 `SubagentRun`、`onSubagentChange`、`subagent-children`、`parseSubagentChildren` 没有新面板之外的消费者。
- 删除 `useAgentSession` 的旧 run type/state/tool event 拼装及 `ChatWindow`/`AppShell` callback。
- 删除旧 route 与 parser 文件。
- 明确保留 Studio tool message renderers、task subagent APIs、runtime registry、Widget 与 child audit SSE。

### 6. DOC-01 / CHK-01 / REV-01

- 更新 `docs/modules/frontend.md`、`docs/modules/api.md`、`docs/modules/library.md`、`docs/architecture/overview.md`；若新增 test script，更新 `docs/standards/code-style.md`。
- 自动验证后启动 `npm run dev`，按 `checks.md` 在真实应用完成菜单、面板、导航、race、响应式、主题和 reduced-motion 验收。
- checker 必须比较获批 HTML 原型与实际组件；发现缺失原型审批、旧猜测链路残留、路径/内容泄漏、非只读 child 或 stale race，结论必须阻塞。

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-child-sessions
npm run test:session-title
npm run test:studio-sdk-runner
```

辅助静态搜索：

```bash
rg -n "SubagentRun|onSubagentChange|subagent-children|parseSubagentChildren" components hooks app lib
rg -n "studio-children|useStudioChildSessions|statusMayBeStale" components hooks app lib docs
```

启动真实浏览器验收：

```bash
npm run dev
```

不要直接运行 `next build`；仅发布/发布级验证使用 `npm run build`。

## 检查门禁

- HTML 原型与当前计划 revision 已有明确用户批准记录。
- 新 endpoint 不依赖 transcript/tool-call/sessionFile 猜测，不返回绝对路径或内容体。
- 两个菜单触发器共享同一菜单组件/动作回调，WorkTree 条件项无能力回退。
- child 行进入现有只读 audit session；父 messages/SSE/model context 无 child 注入。
- active polling 有 abort、visibility 与 cleanup；状态不变不重复动画。
- lint/typecheck/聚焦测试、真实浏览器矩阵和 checker 评审全部通过。

## 回滚

- 无数据迁移；回滚只涉及代码与文档。
- 菜单可恢复旧三点/WorkTree state，不影响 Project Registry 或写 API。
- child 面板可停止 polling并保留事件/手动刷新作为快速降级；若完整回滚，则恢复旧 panel/callback/route。
- 不重写、删除或迁移既有 child JSONL、task.json、transcript sidecar。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "UI-01",
      "title": "交付并审批当前工作区菜单与 Child Sessions HTML 原型",
      "phase": "ui",
      "order": 1,
      "dependsOn": [],
      "files": [
        ".ypi/tasks/20260716-084658-项目选择右键菜单与-chat-顶部-subagents-子-session-嗅探及-ui-改造/ui.md",
        ".ypi/tasks/20260716-084658-项目选择右键菜单与-chat-顶部-subagents-子-session-嗅探及-ui-改造/workspace-subagents-prototype.html",
        ".ypi/tasks/20260716-084658-项目选择右键菜单与-chat-顶部-subagents-子-session-嗅探及-ui-改造/plan-review.md"
      ],
      "instructions": "由主会话指派 ui-designer，基于现有 SessionSidebar、SubagentPanel、SessionStatsChips、AppShell 顶栏与 child audit Chat 产出自包含 HTML；覆盖普通/WorkTree 共享菜单、loading/empty/active/waiting/terminal/stale/error、整行当前工作台导航、浅深主题、375–1440px、键盘和 reduced-motion。用户审批后回填 ui.md 与 plan-review.md；原型未审批不得实现。",
      "acceptance": [
        "任务目录存在可独立打开的真实 HTML 原型",
        "原型覆盖两个菜单触发器及 WorkTree 条件项",
        "原型演示整行进入只读 child audit session",
        "用户明确批准原型与计划当前 revision"
      ],
      "validation": [
        "浏览器检查 1440/1024/900/640/375px",
        "检查浅色、深色、键盘焦点与 prefers-reduced-motion",
        "确认 plan-review.md 链接全部有效"
      ],
      "risks": [
        "当前 architect delegated session 不能直接派发 ui-designer",
        "原型决策可能要求回写后续计划"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "DATA-01",
      "title": "实现父 Session 的 YPI Studio Child Inventory 契约",
      "phase": "implement",
      "order": 2,
      "dependsOn": ["UI-01"],
      "files": [
        "app/api/sessions/[id]/studio-children/route.ts",
        "lib/studio-child-session-list.ts",
        "lib/types.ts",
        "scripts/test-studio-child-session-list.mjs",
        "package.json"
      ],
      "instructions": "新增 no-store session-scoped GET；复用 lightweight active inventory，仅接受 studioChild.kind + parentSessionId 高置信关联；按 cwd/taskId 去重合并 task run 权威状态，header fallback 标记 stale；服务端稳定排序，返回全部正常 active、最近 20 条 terminal 与显式截断计数。wire 严禁 path/cwd/sessionFile/contextId/transcript/prompt/output/summary/error/artifact。新增纯投影聚焦测试。",
      "acceptance": [
        "普通 fork 和旧 tool-call 记录不进入响应",
        "task 状态优先且 header fallback 明示可能过期",
        "waiting_for_user 优先、active 稳定排序、terminal 固定 20 条",
        "响应不含本机路径或 child 内容体",
        "单 task 读取失败只局部降级"
      ],
      "validation": [
        "npm run test:studio-child-sessions",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "curl 检查正常、无 child、404 与 fallback 响应"
      ],
      "risks": [
        "active polling 仍复用全局 inventory 扫描",
        "task detail 读取可能产生 N+1",
        "历史 child 的 task/run 已不存在"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "MENU-01",
      "title": "统一项目选择右键与三点当前工作区菜单",
      "phase": "implement",
      "order": 2,
      "dependsOn": ["UI-01"],
      "files": [
        "components/SessionSidebar.tsx",
        "app/globals.css"
      ],
      "instructions": "将当前工作区菜单内容与动作抽为一个共享渲染单元；三点使用 anchored mode，项目选择按钮右键使用 fixed context mode并做 viewport clamp。保留全部现有项目/空间动作；WorkTree 时两个入口均追加 archive/delete，复用现有 openWorktreeAction 和确认流程。删除顶部专用 worktreeContextMenu，不动 ProjectSpaceSwitchDialog 的任意目标菜单。",
      "acceptance": [
        "两个触发器渲染同一菜单内容和回调",
        "普通空间无 WorkTree 专属项，WorkTree 两入口均有",
        "左键项目选择仍打开 switch dialog",
        "Escape、outside click、边缘定位和危险确认行为正确"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "浏览器比较主空间与 WorkTree 两触发器菜单",
        "确认归档/删除仍走原确认与 fallback 流程"
      ],
      "risks": [
        "fixed/anchored 两种定位造成 z-index 或越界",
        "收敛 state 时误删 dialog context menu",
        "危险动作关闭时序变化"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "PANEL-01",
      "title": "实现 Child Sessions 面板、刷新与当前工作台导航",
      "phase": "implement",
      "order": 3,
      "dependsOn": ["UI-01", "DATA-01"],
      "files": [
        "hooks/useStudioChildSessions.ts",
        "components/SubagentPanel.tsx",
        "components/AppShell.tsx",
        "app/globals.css"
      ],
      "instructions": "实现 keyed AbortController + generation guard hook、initial/error/stale/retry、active+visible 5s polling与清理；AppShell 用 projection 驱动 badge/panel。按获批原型展示分组、状态、截断与动画。整行使用 button/link 语义，激活后关闭面板并以父 workspace context + child projection 构造最小 SessionInfo调用 handleSelectSession，在当前工作台进入既有只读 audit Chat。状态不变不得重播终态动画，reduced-motion 全静态。",
      "acceptance": [
        "快速切换父 session 无旧响应覆盖",
        "active polling 只在可见页面且存在 active child 时运行",
        "loading/empty/waiting/terminal/stale/error 均诚实展示",
        "点击及 Enter/Space 进入正确 child id并关闭面板",
        "child Chat 保持只读且父 Chat 未混入 child 内容",
        "动画符合 160–220ms 与 reduced-motion 口径"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "浏览器模拟慢请求与快速 session 切换",
        "浏览器验证 active→terminal 只播放一次反馈",
        "验证 ?session=<childId>、只读 banner 和输入禁用"
      ],
      "risks": [
        "轮询 timer/visibility listener 泄漏",
        "最小 SessionInfo 构造遗漏 workspace 字段",
        "面板滚动和 topbar z-index 回归",
        "导航切换沿用现有未发送草稿行为"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "CLEAN-01",
      "title": "移除旧 SubagentRun 与 sessionFile 递归探测链路",
      "phase": "implement",
      "order": 4,
      "dependsOn": ["PANEL-01"],
      "files": [
        "hooks/useAgentSession.ts",
        "components/ChatWindow.tsx",
        "components/AppShell.tsx",
        "app/api/agent/subagent-children/route.ts",
        "lib/parse-subagent-children.ts"
      ],
      "instructions": "全仓搜索确认无消费者后，删除 SubagentRun 类型/提取与 tool_execution 状态拼装、onSubagentChange 透传、旧 recursive route/parser。保留 ypi_studio_subagent/ypi_studio_wait 消息渲染、Studio task run API、runtime registry、widget 与 child audit SSE。",
      "acceptance": [
        "顶栏不再依赖 subagent/trellis_subagent tool events",
        "仓内无 /api/agent/subagent-children 调用",
        "旧 route/parser 已删除且无悬空 import",
        "Studio Chat cards/widget/task Subagents tab 保持工作"
      ],
      "validation": [
        "rg -n \"SubagentRun|onSubagentChange|subagent-children|parseSubagentChildren\" components hooks app lib",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "人工发送/查看 ypi_studio_subagent 与 ypi_studio_wait card"
      ],
      "risks": [
        "误删 Studio tool renderer 所需类型",
        "旧 callback 移除造成 ChatWindow props 漏改"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "DOC-01",
      "title": "更新菜单、Child Inventory 与旧链路删除文档",
      "phase": "docs",
      "order": 5,
      "dependsOn": ["MENU-01", "CLEAN-01"],
      "files": [
        "docs/modules/frontend.md",
        "docs/modules/api.md",
        "docs/modules/library.md",
        "docs/architecture/overview.md",
        "docs/standards/code-style.md"
      ],
      "instructions": "记录共享当前工作区菜单、专用 studio-children route、状态权威/fallback、hook/polling/race、直接进入只读 audit session、隐私边界和旧 route/parser 删除；在 standards 中登记新增 test script。文档必须与最终文件名和实际 limit 一致。",
      "acceptance": [
        "API route map 增删与代码一致",
        "frontend/library map 说明新 component/hook/helper",
        "architecture 明确 task status 权威、header stale fallback 与无 child 注入",
        "test 命令已登记"
      ],
      "validation": [
        "审查 docs 中旧 subagent-children/recursive 描述",
        "核对所有新增/删除文件引用",
        "检查 AGENTS.md 是否无需顶层导航变更"
      ],
      "risks": [
        "实现文件命名或 limit 变化后文档滞后"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "CHK-01",
      "title": "执行数据、交互、性能与回归验收",
      "phase": "checks",
      "order": 6,
      "dependsOn": ["DATA-01", "MENU-01", "PANEL-01", "CLEAN-01", "DOC-01"],
      "files": [
        ".ypi/tasks/20260716-084658-项目选择右键菜单与-chat-顶部-subagents-子-session-嗅探及-ui-改造/checks.md",
        "scripts/test-studio-child-session-list.mjs",
        "components/SessionSidebar.tsx",
        "components/SubagentPanel.tsx",
        "hooks/useStudioChildSessions.ts",
        "lib/studio-child-session-list.ts"
      ],
      "instructions": "执行 lint/typecheck/聚焦测试与 checks.md 全矩阵；在真实应用验证普通/WorkTree 菜单、0/1/10+/20+ child、所有状态、stale/error、快速 session 切换、visibility polling、当前工作台导航、只读约束、浅深主题、375–1440px、200% zoom 与 reduced-motion。记录证据和未执行项原因。",
      "acceptance": [
        "所有自动命令通过",
        "真实浏览器矩阵有可复核记录",
        "无路径/内容泄漏和无 child 注入",
        "无 blocker/high finding"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:studio-child-sessions",
        "npm run test:session-title",
        "npm run test:studio-sdk-runner",
        "npm run dev 后真实浏览器验收"
      ],
      "risks": [
        "仓库缺少通用前端自动交互测试框架",
        "缺少真实 active/waiting child fixture",
        "worktree 环境可能无法启动开发服务器"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "REV-01",
      "title": "独立评审原型一致性、数据真实性与只读边界",
      "phase": "review",
      "order": 7,
      "dependsOn": ["CHK-01"],
      "files": [
        ".ypi/tasks/20260716-084658-项目选择右键菜单与-chat-顶部-subagents-子-session-嗅探及-ui-改造/plan-review.md",
        ".ypi/tasks/20260716-084658-项目选择右键菜单与-chat-顶部-subagents-子-session-嗅探及-ui-改造/prd.md",
        ".ypi/tasks/20260716-084658-项目选择右键菜单与-chat-顶部-subagents-子-session-嗅探及-ui-改造/ui.md",
        ".ypi/tasks/20260716-084658-项目选择右键菜单与-chat-顶部-subagents-子-session-嗅探及-ui-改造/design.md",
        ".ypi/tasks/20260716-084658-项目选择右键菜单与-chat-顶部-subagents-子-session-嗅探及-ui-改造/checks.md",
        "components/SessionSidebar.tsx",
        "components/SubagentPanel.tsx",
        "hooks/useStudioChildSessions.ts",
        "lib/studio-child-session-list.ts"
      ],
      "instructions": "checker 对照已批准 HTML/PRD/Design/Checks 审查：菜单是否真正同源、child 是否只按高置信 header、task 状态是否优先、header fallback 是否诚实、terminal 是否 bounded、wire 是否无路径/内容、race/poll cleanup、整行导航与只读 child、旧猜测链路是否清除、动画/reduced-motion 是否符合审批。阻塞项退回实现。",
      "acceptance": [
        "实现与获批原型一致或差异已重新审批",
        "无旧 tool-call/sessionFile 身份推测",
        "无未处理 blocker/high finding",
        "检查证据覆盖真实应用而非只看原型"
      ],
      "validation": [
        "审阅完整 git diff 与删除文件",
        "复核 API 样例和聚焦测试",
        "复核 checks.md 浏览器证据",
        "抽查 child audit read-only API/Chat 行为"
      ],
      "risks": [
        "只检查视觉而遗漏状态权威/隐私",
        "原型验证被错误当作真实组件验收"
      ],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "maxConcurrency": 2,
    "groups": [
      ["UI-01"],
      ["DATA-01", "MENU-01"],
      ["PANEL-01"],
      ["CLEAN-01"],
      ["DOC-01"],
      ["CHK-01"],
      ["REV-01"]
    ]
  }
}
```

> 当前 implementation plan 仅写入 artifact，尚未保存到 `task.json`。因为 HTML 原型尚未交付，本轮必须保持 `planning`；原型交付且规划同步齐备后，主会话才能保存 plan 并 transition 到 `awaiting_approval` 请求用户审批。用户批准前不得进入 `implementing`。
