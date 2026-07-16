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
| `hooks/useAgentSession.ts` | 删除无其他消费者的 `SubagentRun` 类型/拼装/event 更新 | Studio tool progress、wait renderer、session usage 不变 |
| 旧 route/parser | 全仓无消费者后删除 `/api/agent/subagent-children` 与 `lib/parse-subagent-children.ts` | 删除前 `rg` 确认无外部项目内调用 |
| `app/globals.css` | scoped menu/panel/row/动画/断点/reduced-motion | 不创建第二套全局按钮视觉系统 |
| 文档/测试 | 更新 architecture/frontend/API/library/standards test entry | 不修改 AGENTS 顶层入口，除非新增模块被判定为主要入口 |

## 数据来源与权威性

### 身份关联

唯一高置信筛选条件：

```text
session.studioChild.kind === "ypi-studio-child-session"
&& session.studioChild.parentSessionId === requestedParentSessionId
```

普通 `parentSession` 只用于 Pi fork/display 兼容，不能单独作为 Studio child 身份；tool name、transcript 文本、session name、task title 均不能作为关联证据。

### Session inventory

- endpoint 使用 `listAllSessions({ includeStudioChildren: true, includeStudioChildDisplay: true })` 的轻量 active inventory。
- 不扫描 `sessions-archive/`；明确归档的 child 不进入本面板。
- 不调用 `SessionManager.listAll()` / `getEntries()`，不读取 message/tool 内容。
- 复用已有 1 秒 single-flight inventory snapshot；新 endpoint 不引入第二个全局 scanner。

### 状态权威

- `task.json` 对应 `taskId + runId` 的 run 为权威状态、开始/结束时间来源。
- endpoint 按 `cwd + taskId` 分组读取 task detail，避免同一 task 每个 child 重复读取；active/archived task key 解析沿用 YPI Studio task reader。
- task/run 无法读取或不存在时，降级到 child header 的 `status/createdAt/finishedAt`，并返回 `statusSource: "header"`、`statusMayBeStale: true`。
- 单个 task 投影失败不使整个 endpoint 500；该 child 降级，响应可带 bounded warnings/count。只有 inventory/parent resolution 整体失败才返回 endpoint error。
- 不根据 `modified` 时间或 token/tps 猜测 `running`、`runtime_lost`；没有可靠状态时返回 `unknown`/“状态待同步”。

## API 契约

建议新增：

```http
GET /api/sessions/:id/studio-children
Cache-Control: no-store
```

`:id` 是当前选中父 Chat session id。路由验证 id 对应普通 parent session；若选中 New Chat、找不到 session 或 id 指向 Studio child，分别返回可识别的 400/404（客户端显示解释性空态/错误），不自动向上递归寻找另一个父级。

建议响应（字段命名可按现有类型风格微调，但语义不可漂移）：

```ts
type StudioChildPanelStatus =
  | "queued"
  | "running"
  | "waiting_for_user"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "runtime_lost"
  | "unknown";

interface StudioChildSessionListItem {
  sessionId: string;
  taskId: string;
  runId: string;
  member: string;
  subtaskId?: string;
  title: string;
  taskTitle?: string;
  subtaskTitle?: string;
  status: StudioChildPanelStatus;
  rawStatus?: string;
  statusSource: "task" | "header";
  statusMayBeStale: boolean;
  createdAt: string;
  modifiedAt: string;
  startedAt?: string;
  finishedAt?: string;
  messageCount: number;
}

interface StudioChildSessionListResponse {
  kind: "ypi_studio_child_sessions";
  parentSessionId: string;
  children: StudioChildSessionListItem[];
  counts: {
    active: number;
    waitingForUser: number;
    terminalAvailable: number;
    terminalReturned: number;
  };
  limits: {
    terminal: 20;
    terminalTruncated: boolean;
    defensiveActiveCap: number;
    activeTruncated: boolean;
  };
  generatedAt: string;
}
```

隐私/安全要求：

- 不返回 `SessionInfo.path`、`cwd`、`parentSessionFile`、`childSessionFile`、`contextId`、prompt/output/summary/run error/transcript/tool result/artifact。
- 标题来自既有 browser-safe display projection；所有字符串继续使用既有长度预算或 endpoint 再做上限截断。
- active 语义上全部返回；另设高位防御性 hard cap（建议 200）并显式 `activeTruncated`，防止损坏数据制造无界响应。正常 Studio 并发远低于该值。
- recent terminal 固定 20，客户端不能传任意 limit 扩大扫描/响应。

## 分类与排序

1. `waiting_for_user`（最需关注）。
2. 其他 active：`running`，再 `queued`；同组按 `startedAt ?? createdAt` 新到旧。
3. terminal：按 `finishedAt ?? modifiedAt` 新到旧，裁剪最近 20。
4. `unknown` 若没有 `finishedAt`，放在 active 后并标记“状态待同步”；若有 `finishedAt`，按 terminal fallback 排序。
5. 排序必须是服务端稳定排序，客户端只按分组展示，不再发明另一套状态权威。

## 客户端数据流

```text
selectedSession.id
  └─ useStudioChildSessions(id, refreshSignal)
      ├─ GET /api/sessions/:id/studio-children
      ├─ AbortController + request generation guard
      ├─ success: replace projection, clear stale/error
      ├─ refresh failure with old data: keep data + stale error banner
      ├─ initial failure: error/retry state
      └─ any active + document visible: 5s timer; otherwise stop
            ↓
AppShell topbar badge + SubagentPanel
            ↓ row activate
close activeTopPanel → construct minimal SessionInfo from parent context + child item
            ↓
handleSelectSession(childSessionInfo)
            ↓
?session=<childId> + ChatWindow existing read-only child audit flow
```

构造用于导航的 `SessionInfo` 时，客户端复用当前父 session 的 `cwd/projectId/spaceId`，并使用 child item 的 id/created/modified/messageCount/title；`path` 为空即可，服务端 detail/event 路由仍按 session id 解析真实文件。不得为了导航把绝对路径加入新 API。

## 刷新与并发

- selected id 或 refresh generation 变化时 abort 前一请求；除 AbortController 外保留 sequence guard，防止已完成旧 promise 覆盖。
- 初次选择立即取数；面板打开可触发一次 revalidate；手动刷新始终可用。
- 复用 `handleAgentEnd` / 现有 Studio tool-driven session-list refresh key 作为事件触发信号，不解析 tool args/result 生成 child rows。
- 仅响应中存在 active child 且 `document.visibilityState === "visible"` 时每 5 秒 polling；隐藏时暂停，visibility 恢复后立即 revalidate。
- polling 不调用项目空间 sessions endpoint，避免顶栏耦合 Sidebar 完整响应。

## 当前工作区菜单设计

建议将现有 `workspaceMenuOpen` 与顶部专用 `worktreeContextMenu` 收敛为：

```ts
type CurrentWorkspaceMenuState =
  | { mode: "anchored" }
  | { mode: "context"; x: number; y: number }
  | null;
```

- 三点按钮设置 `anchored`；项目选择按钮右键设置 `context`。
- 一个 `CurrentWorkspaceMenu`/内容函数接收 `selectedProjectSpace`、`selectedCwd`、`selectedWorktree` 和现有动作 callbacks。
- anchored 使用三点容器定位；context 使用 fixed 坐标并做 viewport clamp。
- 所有关闭路径统一清空 state；打开该菜单时关闭项目切换 dialog 的临时 context menu，反之亦然，避免叠层。
- WorkTree 尾项调用现有 `openWorktreeAction()`，继续由现有 `WorktreeActionDialog`/确认流程执行；不复制 archive/delete 请求。

## 导航、只读与误操作策略

- 整行激活是导航，不是写操作，不弹二次确认。
- 通过 button/link 语义、进入箭头、tooltip/aria-label“进入只读审计会话”与 `只读` 标识降低误操作。
- 激活顺序：关闭 Subagents panel，再调用 `handleSelectSession`；导航失败时保留当前 parent（实现需避免先清空 selectedSession）。
- 与现有 sidebar session 切换一致，使用当前 tab 与 `router.replace`；本任务不新增新 tab route、不改变浏览器历史策略。
- child detail/SSE 继续走现有 `/api/sessions/[id]` 与 `/api/agent/[id]/events` 的 read-only branch；不需要新 transcript endpoint。

## 旧链路清理

全仓确认无其他消费者后：

- 删除 `hooks/useAgentSession.ts` 的 `SubagentRun`、`extractSubagentRuns`、routing/result helpers、state 与 `tool_execution_*` 拼装更新。
- 删除 `ChatWindow.onSubagentChange`、`AppShell.subagentRuns`。
- 删除 `GET /api/agent/subagent-children` 与 `lib/parse-subagent-children.ts`。
- `ypi_studio_subagent` / `ypi_studio_wait` 的 Chat message renderer、Studio widget/run API 与 task.json 记录完全保留；本清理只针对旧顶栏探测链路。

## 兼容性与迁移

- 不修改现有 Session JSONL、header、task.json 或 Project Registry，无数据迁移。
- 新 endpoint/additive wire types只供新 UI 使用；Sidebar 的 `studioChildrenByParentSessionId` 响应保持不变。
- 历史 Studio child 可通过现有 read-time `studioChildDisplay` 获得标题；task 缺失时 header fallback 仍可展示。
- 回滚为纯代码回滚：恢复旧 panel/callback/route 即可；不需恢复数据。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 每次 polling 扫全局 active inventory | 复用 1s single-flight lightweight scanner；仅 active 时 5s、hidden 停止；专用响应不耦合 project route |
| task detail N+1 | 按 `cwd + taskId` 去重读取；title/status 同次构建；单 task 失败局部降级 |
| header status 可能过期 | task run 优先；header fallback 明示 `statusMayBeStale`，不猜测 runtime_lost |
| 点击行导致误切换 | 明确导航 affordance/只读标识，键盘语义正确；与 sidebar 既有 session 切换一致，不增加确认 |
| endpoint 泄漏本机路径/child 内容 | wire allowlist + 聚焦测试；禁止 path/cwd/sessionFile/contextId/content 字段 |
| polling 重复播放动画 | 以 `sessionId + previousStatus` 检测真实状态变化；初次装载不播放终态反馈；reduced-motion 全禁 |
| 菜单两入口再次漂移 | 单一 menu content + 单一 callbacks；测试/人工验收比较两入口项目项文本与 WorkTree 条件项 |

## 回滚方案

- 菜单：恢复现有三点 JSX 与旧 WorkTree 右键菜单 state；API 无变化。
- Child panel：恢复旧 `SubagentPanel` 与 hook callback；删除新 endpoint/hook/helper/types/CSS。
- 无 JSONL/task/registry 迁移或写入，因此无需数据回滚。
- 若新 endpoint 性能异常，可先关闭 active polling并保留手动刷新/事件刷新，不必恢复 tool-call 猜测。
