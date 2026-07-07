# brief

## 目标

排查并设计修复 YPI Studio SDK child session 在单独打开审计 session tab 时不能实时刷新的问题，并让 child session 标题优先展示 Studio 任务名称。

## 结论摘要

- 普通 chat 的实时刷新依赖 `lib/rpc-manager.ts` 中注册到 `globalThis.__piSessions` 的 `AgentSessionWrapper`，`hooks/useAgentSession.ts` 只有在 `/api/sessions/[id]?includeState` 发现该 wrapper 正在运行/流式输出时才连接 `/api/agent/[id]/events`。
- SDK child session 由 `lib/ypi-studio-child-session-runner.ts` 直接 `createAgentSessionFromServices()` 创建并写 child JSONL，没有注册到 `rpc-manager` 的 wrapper；`/api/sessions/[id]` 对 child 的 `includeState` 因此返回 not running，客户端不会连 SSE，也不会轮询 JSONL。
- 当前 `/api/agent/[id]/events` 在找不到 wrapper 时会 `startRpcSession()`。若对 child 调用，会把 child JSONL 当普通 chat 启动并加载 Web Studio/Browser Share 扩展；这是只读审计视图的安全/边界风险，必须在服务端按 `studioChild` header 分流。
- 标题问题来自两处：`SessionSidebar` 的 `studioChildLabel()` 硬编码为 member/status/run，绕过 `displayTitleForSession()`；runner 写入的 `session_info` 也是 `YPI Studio <member> · <taskId basename> · <run>`，不是任务 title。

## 推荐修复

1. 在 `/api/agent/[id]/events` 先读取 session header；若存在 `studioChild`，不要 `startRpcSession()`，改为 read-only audit SSE：监听 child JSONL 的 mtime/size，发送 `studio_child_audit_changed`，终态发送 `studio_child_audit_end`。
2. `useAgentSession` 对 `session.studioChild` 的 active 状态连接同一 SSE；收到 audit changed/end 后非阻塞 `loadSession()` 重新读取 JSONL，保持输入栏禁用，不加载 tools，不发送命令。
3. 增加 child title projection：服务端从 `.ypi/tasks/<taskId>/task.json` 读取 task title / subtask title / run summary，传给 `SessionInfo`；客户端 title helper 对 child 优先用 task title，badge/tooltip 保留 member/status/run。
4. 保持 `POST /api/agent/[id]` 对 child 的 403；SSE child 分支只读且不创建 AgentSession，因此不会注入 Studio orchestration tools。

## 验收标准

- 打开正在运行的 SDK child session tab 后，消息列表随 child JSONL 增长自动刷新，运行结束后停止刷新。
- child tab 仍显示只读审计文案，无输入框、无 model/tool 控件，POST 继续返回 403。
- 对 child 调用 SSE 不会创建 `AgentSessionWrapper`，不会加载 `createYpiStudioExtension()` / Browser Share 扩展。
- Sidebar/审计 session 标题优先展示 Studio task title；任务缺失时按设计 fallback。
