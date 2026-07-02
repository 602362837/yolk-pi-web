# Design

## 证据与可能根因

### 问题 1：设计后直接进入制作

已读入口：

- `lib/ypi-studio-workflows.ts`
- `lib/ypi-studio-tasks.ts`
- `lib/ypi-studio-extension.ts`
- `app/api/studio/tasks/[taskKey]/route.ts`

关键发现：

1. 默认工作流确实有 `planning -> awaiting_approval -> implementing`，且 `awaiting_approval -> implementing` 标记了 `requiresUserApproval: true`。
2. 但 `transitionYpiStudioTask()` 目前只检查：
   - transition 存在；
   - 如果 `requiresUserApproval`，只要求 `body.reason` 存在；
   - `body.override === true` 可绕过该检查。
3. `ypi_studio_task` 工具由模型调用，模型可以在同一轮内先转 `awaiting_approval`，再带一个 reason 或 override 直接转 `implementing`。
4. prompt/guideline 已写“不要未经批准进入 implementing”，但只是软约束，不是代码硬门禁。
5. `/studio-start` 的注入提示列出“实现和检查分别通过 implementer/checker 指派”，可能诱导模型把完整流程一次性跑完；缺少“到 awaiting_approval 后必须停止本轮”的强提示。

结论：第 1 个问题的根因是 **状态机 approval 边只有 reason/override 软门槛，没有与用户输入绑定的审批凭证**，prompt 也没有强制同轮停机。

### 问题 2：面板慢和持续刷新

已读入口：

- `components/YpiStudioPanel.tsx`
- `components/AppShell.tsx`
- `app/api/studio/tasks/route.ts`

关键发现：

1. `YpiStudioPanel` 挂载后 `reloadAll()` 同时请求 agents/workflows/tasks，即使初始 Tab 是 `tasks` 也会加载成员和流程。
2. `AppShell` 在 Studio task 关联存在或 chat 正在运行时每 3s/10s 增加 `studioSessionTaskRefreshKey`。
3. 该 refreshKey 传给 `YpiStudioPanel` 后，`YpiStudioPanel` 每次执行 `loadTasks()`，并无条件 `setTaskLoadState("loading")`。
4. `TasksTab` 在 `loadState === "loading"` 时用全屏 `PanelEmpty` 替换已有列表/详情，造成“持续刷新、无法阅读”。

结论：慢来自首屏加载过多；阅读打断来自轮询刷新复用首屏 loading 状态，后台刷新覆盖已有内容。

### 问题 3：任务浮窗创建后不实时出现

已读入口：

- `components/AppShell.tsx`
- `components/ChatWindow.tsx`
- `hooks/useAgentSession.ts`
- `lib/ypi-studio-session-link.ts`
- `lib/ypi-studio-extension.ts`
- `lib/ypi-studio-tasks.ts`

关键发现：

1. 浮窗只在 `studioSessionTask?.task` 存在时渲染；`studioLiveOverlays` 只能补充已有浮窗的 live run，不能单独创建浮窗。
2. `AppShell` 通过 `/api/sessions/[id]/studio-task` 解析高置信任务链接；它依赖 exact runtime pointer、task contextId 或 session transcript evidence。
3. `contextKey()` 的 fallback 可能生成 `pi_process_*`。`getYpiStudioTaskIdForContext()` 和 `collectContextEvidence()` 会忽略 `pi_process_*`，因此如果创建任务时未拿到稳定 session id，就无法通过 runtime/context 高置信绑定。
4. 创建任务的 `ypi_studio_task` tool result 中已有 `details.task`，但前端目前没有在该事件结束后立即触发一次 Studio task 重查。
5. 只有 agent end 或轮询会刷新；如果绑定证据延迟写入或 contextId 不稳定，就需要手动刷新页面才出现。

结论：浮窗不实时出现主要是 **绑定键可能不稳定 + 创建工具事件没有即时重查/乐观触发 + 浮窗不能从 live create overlay 启动**。

## 方案摘要

### A. 审批硬门禁

新增“用户审批凭证”概念：

- 当任务转入 `awaiting_approval` 时，在 task meta 记录 `approvalGate`：
  - `enteredAt`
  - `contextId`
  - `from`
  - `artifactsSnapshot` 可选
- 只有当后续用户输入明确批准后，才记录 `approvalGrant`：
  - `approvedAt`
  - `contextId`
  - `inputHash`
  - `source: "user-input"`
- `transitionYpiStudioTask()` 在 `from === "awaiting_approval" && to === "implementing"` 时强制校验：
  - `approvalGrant` 存在；
  - `approvalGrant.contextId === body.contextId`；
  - `approvalGrant.approvedAt > approvalGate.enteredAt`；
  - 不允许 `override` 绕过该边。

用户批准记录由 `lib/ypi-studio-extension.ts` 的 `pi.on("input")` 完成：当当前 task 是 `awaiting_approval`，且用户文本匹配明确批准意图，调用新的 library helper 写入批准凭证。这样同一轮从 planning 进入 awaiting 后不会有后续用户输入，自然无法获得凭证。

推荐批准意图最小匹配：

- 中文：`确认`、`批准`、`同意`、`可以实现`、`开始实现`、`按方案做`、`继续制作`
- 英文：`approve`、`approved`、`go ahead`、`start implementation`、`proceed`

明确修改/否定词（如 `不批准`、`先别`、`修改`、`change`）不得记录批准。

### B. Prompt/流程层修复

- `/studio-start` 文案改成：设计产物完成后只允许转到 `awaiting_approval`，本轮必须停止并向用户展示确认请求；不得调用 implementer。
- `buildStudioState()` 在 `planning` 状态增加“设计完成后停止”的指令；在 `awaiting_approval` 状态增加“只总结方案并等待用户批准/修改”的指令。
- `ypi_studio_task` tool guideline 增加“approval edge has server-side gate; do not use override”。
- 成员委派 prompt 保持“不直接进入实现”的边界，避免 architect 输出中要求主 session 继续实现。

### C. 面板加载/刷新修复

- 将 `YpiStudioPanel` 的加载状态拆分为 `initialLoading` 与 `refreshing`。
- 首次打开时优先加载当前 Tab：初始 `tasks` 时先 `loadTasks()`，members/workflows 后台加载；切换 tab 时再懒加载缺失数据。
- 有旧 `tasksData` 时，后台刷新不设置 `taskLoadState="loading"`，只设置 `tasksRefreshing=true` 并保留当前内容。
- `AppShell` 只在 Studio 面板打开且模式为 studio 时，把 session-task 轮询 refreshKey 传给面板；否则不刷新面板数据。
- 对工作中轮询做节流：运行中最多 5s 一次，非运行中 15-30s 或只在 agent end 触发。
- 任务详情页单独支持静默刷新 summary/detail，避免列表刷新导致详情重载。

### D. 浮窗实时同步修复

- 调整 `contextKey()`：优先使用 `ctx.sessionManager.getSessionId()`，其次 session file hash，再考虑 input/env；避免 web 主 session 落到 `pi_process_*`。
- 创建/绑定/transition/update artifact 时写入稳定 contextId；若当前 key 是 `pi_process_*` 且 ctx 能提供 session id，则改写为 stable key。
- `ChatWindow`/`AppShell` 在 Studio tool progress 中发现 `ypi_studio_task` 的 result/partialResult 包含 `details.task.id/key` 时，立即去抖触发 `setStudioSessionTaskRefreshKey`。
- `resolveYpiStudioTaskForSession()` 保持高置信策略，但受益于稳定 contextId； transcript evidence 作为兜底。

## 影响模块和边界

- `lib/ypi-studio-tasks.ts`
  - 新增 approval gate/grant helper 和 transition 校验。
  - 修改 `transitionYpiStudioTask()` 的 approval edge 逻辑。
- `lib/ypi-studio-extension.ts`
  - `contextKey()` 优先级调整。
  - `pi.on("input")` 识别 awaiting approval 的用户批准并写入 grant。
  - prompt/guideline 修改。
- `components/AppShell.tsx`
  - Studio session task refresh 触发和面板 refreshKey 传递策略。
- `components/ChatWindow.tsx`
  - Studio tool progress snapshot 可增加 `taskId/taskKey` 签名，确保 create result 触发父级回调。
- `components/YpiStudioPanel.tsx`
  - 懒加载、后台刷新状态、保留已有内容。
- `docs/architecture/overview.md`、`docs/modules/frontend.md`、`docs/modules/library.md`
  - 更新审批门禁、刷新策略、session-task 绑定说明。

## 兼容性、风险、回滚

- 兼容已有任务：无 `approvalGate` 的旧任务如果已在 `awaiting_approval`，用户下一条明确批准即可写入 grant；如已在 `implementing` 不回退。
- 自定义 workflow：只对任意 workflow 中 `awaiting_approval -> implementing` 且/或 `requiresUserApproval` 的边执行硬门禁；更通用可按 `transition.requiresUserApproval` 门禁，但最小修复先强制标准边。
- 风险：批准意图误判。缓解：只接受明确批准词；否则要求用户明确回复“确认/批准”。
- 回滚：审批门禁可通过移除新增 grant 校验回退；面板刷新改动只影响 UI 状态；contextKey 调整需注意不破坏 bash 注入的当前 task 绑定。
