# design

## 根因分析

### 普通 chat 为什么能实时刷新

1. 新建/继续普通 chat 时，`app/api/agent/new` 或 `app/api/agent/[id]` 会调用 `startRpcSession()`。
2. `startRpcSession()` 在 `lib/rpc-manager.ts` 创建 `AgentSessionWrapper`，注册到 `globalThis.__piSessions`，并通过 `wrapper.start()` 订阅 Pi SDK events。
3. `hooks/useAgentSession.ts` 打开已有 session 时调用 `/api/sessions/[id]?includeState`；该 route 只看 `getRpcSession(id)`。若 wrapper alive，返回 `agentState.running=true` 与 `isStreaming/studioChildRunCount`。
4. hook 检测正在运行后连接 `/api/agent/[id]/events`，该 route 复用 wrapper 的 `session.onEvent()`，浏览器收到 message/tool/agent_end 后更新 state 并在 agent_end 重新 `loadSession()`。

### child audit tab 为什么不会刷新

1. SDK child runner 在 `lib/ypi-studio-child-session-runner.ts` 内部直接创建独立 Pi SDK session：`createAgentSessionServices()` + `createAgentSessionFromServices()`。
2. 该 child session 写持久 child JSONL header（`studioChild`）并持续 append JSONL，但不会注册到 `rpc-manager` 的 `__piSessions`。
3. `/api/sessions/[id]?includeState` 对 child 只会看到 `getRpcSession(childId)` 为空，因此返回 not running。
4. `useAgentSession` 只有普通 wrapper running/streaming 时才 `connectEvents()`；child audit tab 因此只读取一次 `/api/sessions/[id]`，之后没有 SSE、没有 polling、没有文件 watch。
5. 当前 `/api/agent/[id]/events` 若被 child 调用，会在 wrapper 缺失时执行 `startRpcSession(childId, filePath, cwd)`，这会把 child JSONL 当普通 Web chat 启动，并通过 `DefaultResourceLoader` 注入 YPI Studio / Browser Share 扩展。虽然 POST route 已拒绝 child 非 abort 命令，但 SSE route 本身缺少 child guard。

## 修复方案

### API / SSE

修改 `app/api/agent/[id]/events/route.ts`：

1. `resolveSessionPath(id)` 后先读取 header（建议复用 `readSessionHeaderFromFile()` 或新增轻量 helper）。
2. 若 `header.studioChild` 存在：
   - 直接返回 read-only audit SSE，不调用 `startRpcSession()`。
   - 初始事件：`{ type: "connected", sessionId: id, mode: "studio_child_audit" }`。
   - 用 `setInterval` + `statSync(filePath)` 或 `fs.watchFile` 检查 `mtimeMs/size`；变化后 debounce 100-250ms，发送：
     `{"type":"studio_child_audit_changed","sessionId":id,"mtimeMs":...,"size":...,"studioChildStatus":...}`。
   - 若 header `studioChild.status` 进入终态（非 `queued/running`），先发送最后一次 changed，再发送：
     `{"type":"studio_child_audit_end","sessionId":id,"status":"succeeded|failed|..."}`。
   - 保留 30s heartbeat；abort/cancel 时清理 timer/watch。
3. 若不是 child，保持现有 wrapper/startRpcSession 行为。

安全边界：child SSE 分支只读文件元数据/触发客户端 reload，不实例化 AgentSession，不加载 ResourceLoader，不返回 tools，不接受命令。`app/api/agent/[id]/route.ts` 的 child POST 403 保持不变。

### Client

修改 `hooks/useAgentSession.ts`：

1. 增加 child active 判断：`studioChild.status` 为 `queued/running` 或缺失但 `finishedAt` 不存在时视作可跟踪。
2. 打开 child session 时，`loadSession(session.id, true, true)` 后即使 `agentState.running=false`，也连接 SSE；不要调用 `loadTools()`。
3. `handleAgentEvent` 增加：
   - `studio_child_audit_changed`：非阻塞调用 `loadSession(sid, false)`，成功则替换 messages/entryIds/tree；失败保留当前内容，避免瞬时 JSONL 重写导致 UI 进入永久 error。
   - `studio_child_audit_end`：再 `loadSession()` 一次，`setAgentRunning(false)`，`setAgentPhase(null)`，关闭 EventSource，并触发 `onAgentEnd?.()` 刷新 sidebar/widget。
4. `connectEvents()` 可复用同一 URL，但对 `connected.mode === "studio_child_audit"` 不走普通 agent_start 语义。
5. `ChatWindow.tsx` 已根据 `session.studioChild` 隐藏 `ChatInput` 并显示只读 banner；保持不变。可选增加 phase label 为“正在跟踪 Studio child session…”。

### 标题策略

当前问题：

- `components/SessionSidebar.tsx` 的 `studioChildLabel()` 用 `Studio <member> · <subtaskId> · <status> · <run>`，所以不会显示任务名称。
- `lib/ypi-studio-child-session-runner.ts` 写入的 `session_info` 是 generic fallback，不保证等于 task title。

建议新增 `SessionInfo.studioChildDisplay?: { taskTitle?: string; subtaskTitle?: string; runSummary?: string }`（命名可调整），由服务端 UI 列表/detail接口填充：

数据来源与 fallback：

1. `.ypi/tasks/<taskId>/task.json` 的 `title`（权威 task 名称）。
2. 若 task 已归档或 active 读取失败，用 `listYpiStudioTasks(cwd,{scope:"all"})` 按 id 查找，再读对应 detail。
3. 若有 `subtaskId`，从 `implementationPlan.subtasks[].title` / `implementationProjection.subtasksWithStatus[].title` 取 subtask title，放到 subtitle/tooltip，不抢主标题。
4. 若 task title 缺失：用 matching run 的 `summary` 或 `progress.lastTextPreview`（截断到 `SESSION_TITLE_MAX_LENGTH`）。
5. 再 fallback 到 child header 的 `taskId` 去掉时间/slug、`session.name`、`session.firstMessage`、最后 `Studio <member> · <runId8>`。

客户端呈现：

- `displayTitleForSession()` 支持 child display 字段：child 主标题优先 taskTitle。
- Sidebar row 标题使用 `displayTitleForSession(session)`；badge 保留 `member · status`；tooltip/次级信息展示 `subtaskTitle`、`runId`。
- 可选在 runner 创建 child 时把 session_info 改为 `YPI Studio <taskTitle> · <member> · <runId8>`，作为 task.json 不可读时的 durable fallback；不要依赖它作为权威标题。

## 兼容性与风险

- 不迁移旧 JSONL；所有新增字段都是 API projection / optional type。
- child JSONL 可能在 header rewrite 时短暂不可解析：SSE 端 debounce，客户端 reload 失败不清空当前消息。
- `task.json` 是 Studio 状态权威，child header 状态是 best-effort。若进程崩溃导致 header 仍 running，audit SSE 可能持续跟踪；可在后续增强中用 task run terminal status 结束 SSE。
- 不改变 child runner 的 guard：仍使用 `createYpiStudioChildGuardExtension()` + `excludeTools` 防递归 Studio/browser action tools。
