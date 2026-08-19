# Brief：反代环境下 Chat 完成后 Stop 状态不清除

## 结论

这是一个 **SSE 终态只依赖单次 `agent_end` 推送、缺少断线/丢帧后的权威状态补偿** 的可靠性问题；反向代理缓冲会放大该问题。

当前浏览器把 `agentRunning` 作为 Chat 输入区 `isStreaming` 的唯一来源。收到 `agent_end` 时它会清为 `false`；若最后一帧被反代缓冲、连接在终态前断开，或重连发生在 `agent_end` 之后，前端没有其它稳定路径结束运行态，因此仍显示 Stop。此时服务端实际已 idle，点击 Stop 进入 abort，但无活动 turn 可中止，所以看起来“点击无效”；刷新会通过 `includeState` 重新读取权威状态，因而恢复。

修复应采用四层防护，而不是只调一个超时：

1. **SSE 传输防缓冲**：Chat SSE 响应补齐 `no-store/no-transform` 与 `X-Accel-Buffering: no`。
2. **连接快照**：`connected` 增加浏览器安全、可向后兼容的 runtime snapshot，使重连能知道当前是否仍在 streaming / 等待 Studio children。
3. **重连补偿**：断线和重连时查询/应用权威运行态；若终态已发生，主动合成同一条完成收敛路径。
4. **前端 watchdog**：仅在本地认为运行中时做低频、带竞态保护的状态核对，覆盖连接未报错但尾帧被缓冲的情况。

## 用户现象

- 通过远程 HTTPS 反向代理访问 YPI。
- assistant 回复内容已经完整显示。
- 输入区仍处于运行态，右侧显示 **Stop**。
- 点击 Stop 没有可见效果。
- 刷新页面后恢复 **Send**。

## 代码证据

### 1. Stop 完全由本地 `agentRunning` 驱动

- `components/ChatWindow.tsx` 把 `agentRunning` 传给 `ChatInput.isStreaming`。
- `components/ChatInput.tsx` 在 `isStreaming` 为真时显示 Stop，否则显示 Send。
- 所以 Stop 卡住不是按钮本身问题，而是 `agentRunning` 未收敛。

### 2. 正常完成只靠 `agent_end`

`hooks/useAgentSession.ts` 的 `agent_end` 分支负责：

- `setAgentRunning(false)`（没有活动 Studio child 时）；
- 清理 phase/retry/stream state；
- 重载 session 与 runtime state；
- 触发 `onAgentEnd`。

如果该事件没到浏览器，当前没有等价终态路径。

### 3. 当前重连只“重新订阅”，不做状态补偿

`hooks/useAgentSession.ts` 的 `EventSource.onerror`：

- 仅在本地仍认为 running 时关闭流；
- 1 秒后重新连接；
- 没有在断线前或重连后查询 `/api/agent/[id]`；
- `connected` 对普通 Chat 不处理 runtime 状态。

`app/api/agent/[id]/events/route.ts` 的普通流只订阅未来事件。若 `agent_end` 恰好发生在断线窗口，新连接只收到 `connected`，不会重放已发生的终态。

### 4. 服务端已有权威状态，但语义容易误用

- `GET /api/agent/[id]` 返回 wrapper 是否 alive 的顶层 `running`；wrapper alive **不等于 turn 正在 streaming**。
- 真正 turn 状态在 `state.isStreaming`。
- Studio 父会话还必须结合 `state.studioChildRunCount`，不能在主模型 turn 结束但 child 仍运行时错误切回 idle。
- `GET /api/sessions/[id]?includeState` 已在刷新/初次打开时应用这组语义，所以刷新能恢复。

### 5. Chat SSE 缺少项目内已有的反代防缓冲头

`app/api/agent/[id]/events/route.ts` 当前响应头只有：

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`

同仓库 `app/api/files/[...path]/route.ts` 的 SSE watch 已使用：

- `Cache-Control: no-cache, no-transform`
- `X-Accel-Buffering: no`

Chat SSE 未复用该防护。30 秒 comment heartbeat 可防部分 idle timeout，但不能替代禁止代理缓冲，也不能补偿丢失的 `agent_end`。

### 6. 初始连接存在反向竞态

发送已有 session 消息时，前端先乐观设 running，再 `connectEvents(sid)`，然后 POST prompt。SSE 的初始 `connected` 可能在 prompt 真正开始前到达，此时权威 `isStreaming=false` 是合法瞬态。实现不能把任何一次 idle snapshot 都立即当终态；必须区分：

- 首次“为即将开始的 turn 建流”；
- 已观察到 `agent_start` 的活动 turn；
- 断线重连；
- POST preflight 已成功但事件可能缺失；
- Studio children 仍活动。

## 根因链

```text
assistant 内容已到浏览器
  → 服务端完成 turn 并发出 agent_end
  → 反代缓冲尾帧 / 连接终态前断开
  → 浏览器未收到 agent_end
  → EventSource 重连只订阅未来事件
  → 服务端已经 idle，不会再发旧 agent_end
  → agentRunning 永久保留 true
  → ChatInput 持续显示 Stop
  → abort 命中空闲 wrapper，无可见变化
  → 刷新通过 includeState 得到 isStreaming=false，UI 恢复
```

## 设计边界

### 范围内

- 普通 Chat SSE 响应头与 stream cleanup 可靠性。
- 普通 Chat `connected` 的可选 runtime snapshot。
- Web `useAgentSession` 的断线重连、运行态核对、终态幂等收敛。
- Studio child run 计数兼容。
- focused 自动测试、反代人工验收与文档。

### 范围外

- 不改变 assistant 消息内容、JSONL、模型调用、RPC wrapper 生命周期。
- 不新增手动“恢复”按钮、错误横幅或状态文案。
- 不把全站所有 SSE 一次性重构为新框架。
- 不承诺绕过不支持 streaming、会强制聚合整个响应的 CDN/网关；此类部署仍需正确配置代理。
- `ypic` 不在本次改交互范围；服务端 additive `connected.state` 必须保持旧 CLI 可忽略，且运行 `test:ypic-cli` 防回归。

## UI Prototype Gate 初判

**触发。** 虽然计划不新增视觉元素，但任务改变现有 Chat 的 Stop → Send 交互状态收敛，符合 Studio 规则中的“已有交互变化”。必须由主会话派发 `ui-designer`，基于现有 ChatInput 产出 HTML 原型，确认：

- 运行中仍显示现有 Stop；
- 服务端已 idle 且终态经补偿确认后自动恢复现有 Send；
- 重连仍在运行时不得闪回 Send；
- 不新增文案、按钮、布局或 loading 状态。

当前 delegated architect 环境没有 Studio delegation/transition 工具，无法真实派发 UI 设计员；因此不能推进 `awaiting_approval`。
