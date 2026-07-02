# Implement

## 建议实现顺序

### 1. 增加审批门禁（最高优先级）

先读：

- `lib/ypi-studio-tasks.ts`
- `lib/ypi-studio-types.ts`
- `lib/ypi-studio-extension.ts`
- `app/api/studio/tasks/[taskKey]/route.ts`

步骤：

1. 在 `YpiStudioTaskRecord.meta` 约定新增字段：
   - `approvalGate?: { enteredAt: string; contextId?: string; from: string; to: "awaiting_approval" }`
   - `approvalGrant?: { approvedAt: string; contextId: string; inputHash: string; source: "user-input" }`
2. 在 `transitionYpiStudioTask()` 中：
   - 当 `body.to === "awaiting_approval"`，写入/刷新 `approvalGate`，并清除旧 `approvalGrant`。
   - 当 `from === "awaiting_approval" && body.to === "implementing"`：调用 helper 校验 grant；失败则 throw 明确错误。
   - 该边即使 `body.override === true` 也不得绕过。
3. 新增 helper（命名可调整）：
   - `recordYpiStudioUserApproval(cwd, contextId, inputText): YpiStudioTaskDetail | null`
   - `isExplicitYpiStudioApprovalText(text): boolean`
   - `assertYpiStudioImplementationApproved(task, contextId)`
4. 在 `lib/ypi-studio-extension.ts` 的 `pi.on("input")` 中：
   - 获取 stable context key。
   - 若 current task status 为 `awaiting_approval` 且用户文本明确批准，则记录 grant。
   - 若未批准，继续注入提示：当前等待确认，必须展示方案并等待。
5. 更新 tool guideline 和 `/studio-start` 文案：明确“到 awaiting_approval 后本轮停止，不得调用 implementer”。

### 2. 修复稳定 session/task 绑定

先读：

- `lib/ypi-studio-extension.ts` 的 `contextKey()`、`getKey()`、bash 注入。
- `lib/ypi-studio-session-link.ts`
- `lib/ypi-studio-tasks.ts` runtime pointer 读写。

步骤：

1. 调整 `contextKey(input, ctx)` 优先级：
   - `ctx.sessionManager.getSessionId()` -> `pi_<sessionId>`
   - `ctx.sessionManager.getSessionFile()` -> `pi_transcript_<hash>`
   - input 中显式 session id/transcript
   - env `YPI_STUDIO_CONTEXT_ID`
   - fallback `currentKey/procKey`
2. 保留 bash 注入使用 `getKey()` 得到当前 stable key；如果没有 stable key，再使用 procKey。
3. 在 task create/bind/update/transition 后，确认 task.contextIds 中包含 stable key，runtime pointer 写入 `.ypi/.runtime/sessions/<stable>.json`。
4. 如现有测试/fixture 可覆盖，增加 `pi_process_*` 不作为 session-widget 高置信依据的回归测试；同时验证 stable key 可解析。

### 3. 前端浮窗即时刷新

先读：

- `hooks/useAgentSession.ts` tool progress 事件处理。
- `components/ChatWindow.tsx` 的 `studioProgressSignature` 和 overlay 构建。
- `components/AppShell.tsx` 的 `handleStudioToolProgressChange`、`loadStudioSessionTask`、轮询 effect。

步骤：

1. 扩展 `studioProgressSignature`：包含 Studio overlay 的 `taskId/taskKey/status/running`，确保 create tool result 后父组件收到更新。
2. 在 `AppShell.handleStudioToolProgressChange()` 中：
   - 如果 overlays 中出现新的 `taskId`/`taskKey`，立即 `setStudioSessionTaskRefreshKey(k => k + 1)`。
   - 加 300-800ms debounce，避免 tool update 高频刷新。
3. 保留 agent end 刷新作为兜底。
4. 可选：若 `studioSessionTask` 为空但 overlay 有 taskId，显示一个轻量“Studio task linking…”小浮窗；最小修复可不做。

### 4. 面板加载与后台刷新

先读：

- `components/YpiStudioPanel.tsx`
- `components/AppShell.tsx` right panel render 和 Studio refreshKey 传递。

步骤：

1. 在 `YpiStudioPanel` 中拆分加载函数参数：`loadTasks(signal, { background?: boolean })`。
2. `background=true` 且已有 `tasksData` 时，不设置 `taskLoadState="loading"`；新增 `tasksRefreshing` 只显示小型状态徽标。
3. 初次挂载根据 `initialTab`：
   - `tasks`：先 `loadTasks()`；members/workflows 用 `void` 后台加载或切 tab 懒加载。
   - `members/workflows` 同理。
4. `refreshKey` effect 改为后台刷新任务：`loadTasks(undefined, { background: true })`。
5. `TasksTab` 逻辑改为：如果 `loadState === "loading" && data`，继续渲染旧数据并显示“刷新中”。
6. `AppShell` 只在 `rightPanelOpen && rightPanelMode === "studio"` 时向 `YpiStudioPanel` 传递不断变化的 `refreshKey`；否则传稳定值或不触发。
7. 调整轮询间隔：运行中 5s；非运行中 15-30s；无 task 且非运行中不轮询。

### 5. 文档更新

更新：

- `docs/architecture/overview.md`：YPI Studio approval gate、stable context binding、panel refresh policy。
- `docs/modules/library.md`：`ypi-studio-tasks` 和 `ypi-studio-extension` 新职责。
- `docs/modules/frontend.md`：`YpiStudioPanel`、`YpiStudioSessionWidget` 刷新/实时同步行为。

## 验证命令

最小验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

建议补充针对 `lib/ypi-studio-tasks.ts` 的单元测试或脚本级回归；若项目暂无测试框架，至少用手工任务目录验证。

如项目已有测试框架，可增加针对 `lib/ypi-studio-tasks.ts` 的单元测试；若无测试框架，至少用手工任务目录验证。

## 检查门禁

- 未经用户批准，`awaiting_approval -> implementing` 必须失败。
- 用户明确批准后，下一轮允许进入 `implementing`。
- `override=true` 不得绕过审批边。
- Studio 面板打开后，后台刷新不清空当前阅读内容。
- 创建任务后，浮窗在无需整页刷新情况下出现。

## 回滚方案

- 若审批门禁误伤，可临时仅放宽批准词匹配，不要回滚硬门禁。
- 若面板懒加载引发数据显示缺失，可恢复 `reloadAll()`，但保留后台刷新不清屏。
- 若 contextKey 调整影响 bash 绑定，可保留 stable key 优先，并在 fallback 才使用 env/procKey。
