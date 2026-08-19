# Design：SSE 终态补偿与前端运行态收敛

## 方案摘要

采用“**传输尽量不丢 + 连接提供快照 + 客户端权威核对 + 幂等终态**”四层方案：

```text
AgentSessionWrapper
  ├─ live events: agent_start / message_* / tool_* / agent_end
  └─ synchronous safe snapshot: isStreaming + studioChildRunCount + isCompacting
                 │
                 ▼
GET /api/agent/:id/events
  subscribe first → emit connected(state) → stream future events
  anti-buffering headers + heartbeat + idempotent cleanup
                 │
                 ▼
useAgentSession
  initial subscription / reconnect / watchdog
  → resolve authoritative active = isStreaming || childCount > 0
  → active: keep Stop / reconnect
  → idle + valid completion evidence: convergeTurnEndOnce()
  → query failed: keep current state (fail-safe)
```

单独加 `X-Accel-Buffering` 不足以覆盖断线窗口；单独前端超时会误杀慢请求；单独重连也无法重放历史 `agent_end`。四层组合才能同时处理代理缓冲、终态丢失和竞态。

## AS-IS

### 服务端

1. `AgentSessionWrapper.start()` 将 SDK events 转发给当前 listeners。
2. `agent_end` 是瞬时事件，不持久化为可重放队列。
3. `/events` 新订阅只收到 `connected` 和订阅后的 future events。
4. Chat SSE 没有 `X-Accel-Buffering: no` / `no-transform`。
5. 普通 stream cleanup 没有 closed guard；重复 abort/close 可能抛错。

### 前端

1. send 时乐观 `agentRunning=true`。
2. 普通完成依赖 `agent_end` 清状态。
3. `onerror` 只重连，不读取权威状态。
4. `connected` 不处理普通 Chat 状态。
5. 没有 running-only watchdog。
6. 页面刷新通过 `includeState` 恢复，说明服务端状态可作为补偿真相。

## TO-BE

### 1. 浏览器安全 runtime snapshot

在 `lib/rpc-manager.ts` 为 `AgentSessionWrapper` 增加同步只读投影，例如：

```ts
export interface AgentRuntimeSnapshot {
  isStreaming: boolean;
  studioChildRunCount: number;
  isCompacting: boolean;
}

getRuntimeSnapshot(): AgentRuntimeSnapshot
```

约束：

- 只读当前 `inner.isStreaming`、`inner.isCompacting` 与 Studio runtime count；
- 不调用模型、不读取 JSONL、不创建新 wrapper；
- 不返回 `sessionFile`、cwd、model、systemPrompt、工具/消息内容；
- `get_state` 可复用该基础 active 字段，减少两套定义漂移，但保持现有 wire 字段兼容。

### 2. Race-safe SSE handshake

`app/api/agent/[id]/events/route.ts` 普通流启动顺序：

```text
A. 建立 encoder / closed guard
B. session.onEvent(listener)       // 先订阅
C. session.getRuntimeSnapshot()    // 同一同步 turn 读取
D. emit connected { state }
E. 后续 events 正常转发
```

为什么先订阅：

- 如果 `agent_end` 已在 B 之前发生，C 读到 idle；
- 如果 `agent_end` 在 B 之后发生，listener 能收到它；
- 不采用“先 await get_state，再 subscribe”，避免新 race window。

JavaScript 单线程同步步骤 B→C→D 之间没有 `await`，SDK callback 不会插入到同步 call stack 中。即使事件随后紧接到达，客户端也能按事件顺序收敛。

`connected.state` 为 additive；旧客户端只按 `type` 处理，保持兼容。

### 3. SSE headers 与 lifecycle

统一 `sseResponse()`：

```text
Content-Type: text/event-stream
Cache-Control: no-cache, no-store, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

继续每 30 秒发送 SSE comment heartbeat。stream cleanup 必须 idempotent：

- `closed` guard；
- clear heartbeat；
- unsubscribe；
- remove abort listener；
- `controller.close()` 包 try/catch；
- enqueue 失败时触发 cleanup。

Studio child audit 分支复用同一 response headers，不改变其文件跟随语义。

### 4. 前端状态契约

建议新增 `lib/agent-runtime-state.ts`（纯函数，可在 server/client 共用安全类型）：

```ts
export interface AgentRuntimeActivitySnapshot {
  isStreaming: boolean;
  studioChildRunCount: number;
}

export function projectAgentRuntimeActivity(snapshot):
  | { kind: "streaming" }
  | { kind: "waiting_for_studio_children"; activeRunCount: number }
  | { kind: "idle" }
```

注意：顶层 wrapper `running` 不参与 activity 判定。

### 5. `useAgentSession` 的连接模式

`connectEvents` 需要显式连接原因/代次：

```ts
type EventConnectionReason = "turn_start" | "resume" | "reconnect";
```

- `turn_start`：connect 早于 POST prompt，初始 idle snapshot 不能立即结束 optimistic running。
- `resume`：页面打开时已有 `includeState` 结果；snapshot 用于校正。
- `reconnect`：已有 turn evidence；idle snapshot 可补偿丢失终态。

每次连接分配 generation；旧 EventSource、旧 timeout、旧 state fetch 结果不能提交到新 session/generation。

### 6. Turn evidence 与防误清规则

建议 refs：

- `turnGenerationRef`
- `turnStartedAtRef`
- `turnAcceptedRef`（prompt preflight POST 已成功）
- `turnActiveObservedRef`（收到 `agent_start` 或权威 streaming）
- `turnTerminalRef`（本代已收敛）
- `lastAgentEventAtRef`
- `runtimeProbeAbortRef`

应用 idle snapshot 的规则：

1. session/generation 不匹配 → 丢弃。
2. 本代已 terminal → no-op。
3. Studio child count > 0 → 保持 running，phase=`waiting_for_studio_children`。
4. `isStreaming=true` → 保持 running，标记 active observed。
5. `isStreaming=false`：
   - `reconnect` 且已观察 active / POST 已成功并过保护期 → 结束；
   - watchdog 在已观察 `message_end` / `agent_end` gap 或 POST 成功并过保护期后 → 结束；
   - 初始 `turn_start` 且 POST 尚未完成/保护期内 → 忽略，等待 start 或下一 probe。
6. probe 失败 → fail-safe 保持 running。

不要用“回复文本看起来完整”作为完成依据；消息内容不是 runtime truth。

### 7. Watchdog

仅当 `agentRunning=true` 且普通 Chat 非只读 Studio child audit 时启动：

- 建议每 5 秒检查一次；
- 当前 SSE 长时间无业务 event、`message_end` 后未见 `agent_end`、或处于 reconnect 时优先 probe；
- 每次只允许一个 in-flight probe；
- session/generation 改变立即 abort；
- idle 后清 timer；
- 失败指数/分段退避至最多 15 秒，不报用户可见错误。

watchdog 调用既有 `GET /api/agent/:id` 即可；也可以提取轻量 endpoint，但本任务不需要新增 route。响应判定必须读取 `state.isStreaming` 与 `state.studioChildRunCount`。

### 8. 统一终态收敛

把当前 `agent_end` 分支拆成幂等函数（命名示例）：

```ts
convergeAgentTurnEnd({
  source: "event" | "connected_snapshot" | "disconnect_probe" | "watchdog",
  studioChildRunCount,
  generation,
})
```

行为：

- child count > 0：不 terminal，切 waiting phase；
- 否则 compare-and-set `turnTerminalRef`；
- 清 `agentRunning`、phase、retry、stream reducer；
- 关闭当前 SSE 与 probe/watchdog；
- `loadSession(... includeState=true)` 与 usage refresh；
- 恰好一次 `onAgentEnd`。

完成提示音当前由 `ChatWindow` 包装 `handleAgentEventRef` 的 `agent_end` 触发。补偿路径应通过同一 handler 注入一个内部标记的 synthetic `agent_end`，或将 done callback 显式纳入统一终态 API；无论选择哪种，都要防真实迟到 `agent_end` 重复响铃。不得把 synthetic event 写回服务端/JSONL。

### 9. `agent_error` 与 abort

- `agent_error` 保持展示现有 error，并进入 terminal cleanup；如果随后真实 `agent_end` 到达，幂等 no-op。
- abort API 不改。若 abort await 超时，watchdog 继续核对，服务端 idle 后仍可收敛。

## 数据流场景

### 正常流

```text
connect(turn_start idle snapshot ignored)
→ POST prompt preflight ok
→ agent_start / deltas / message_end / agent_end
→ converge(event) once
→ Send
```

### 反代扣住尾帧但连接不报错

```text
deltas delivered → message_end delivered → agent_end buffered
→ watchdog GET state: isStreaming=false, child=0
→ converge(watchdog) once
→ Send
→ late agent_end (if eventually flushed) ignored by terminal guard
```

### 断线期间完成

```text
active event observed → connection error
→ probe/reconnect
→ new connected.state idle OR GET idle
→ converge(reconnect) once
```

### 仍在运行时重连

```text
connection error → connected.state isStreaming=true
→ keep Stop
→ future agent_end → normal converge
```

### Studio children

```text
agent_end/connected snapshot: isStreaming=false, childCount=2
→ keep running + waiting_for_studio_children
→ continuation starts or later count reaches 0
→ only then converge idle
```

## 影响模块和边界

| 模块 | 计划改动 | 不变项 |
| --- | --- | --- |
| `lib/rpc-manager.ts` | 安全同步 runtime snapshot | wrapper registry、idle timeout、SDK lifecycle |
| `app/api/agent/[id]/events/route.ts` | additive connected state、headers、cleanup | route path、event body透传、Studio audit语义 |
| `hooks/useAgentSession.ts` | reconnect/probe/watchdog/terminal dedupe | Chat message rendering、model pin、usage口径 |
| `lib/agent-runtime-state.ts`（建议新增） | 纯类型与 activity 判定 | 无 I/O/React |
| `scripts/test-agent-sse-recovery.mjs`（建议新增） | focused contract/race tests | 不访问真实 provider |
| docs | API/frontend/library/architecture/deploy/troubleshooting | 无配置迁移 |
| `bin/ypic.js` | 默认不改，仅兼容测试 | 现有 CLI reconnect 语义 |

## API / Wire 契约

### `GET /api/agent/:id/events`

`connected` 从：

```json
{"type":"connected","sessionId":"..."}
```

additive 为：

```json
{
  "type": "connected",
  "sessionId": "...",
  "state": {
    "isStreaming": true,
    "studioChildRunCount": 0,
    "isCompacting": false
  }
}
```

所有字段均可选读；其它 event 不变。

### `GET /api/agent/:id`

不改 response schema。实现/测试中明确：

- `running` = wrapper alive；
- `state.isStreaming` = model turn active；
- `state.studioChildRunCount` = Studio background activity。

## 兼容性与迁移

- 无磁盘/schema/config/JSONL 迁移。
- `connected.state` additive，旧 Web/CLI 忽略。
- headers 只强化 streaming，不改变 payload。
- 多实例部署的 SSE 与 RPC wrapper 必须仍有 session affinity；本任务不解决无粘性负载均衡把 GET probe 路由到另一进程的问题，运维文档需标为剩余风险。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 初始 idle snapshot 提前清 running | 连接 reason + turn evidence + grace window |
| wrapper alive 被误判 active | 只读 `state.isStreaming || childCount>0` |
| watchdog 增加请求 | running-only、5s、single-flight、idle立即停、退避 |
| 查询失败误结束 | fail-safe 保持 running |
| 真实和 synthetic end 重复回调/声音 | per-turn terminal compare-and-set |
| session 切换后旧 probe 污染 | session id + generation + AbortController |
| Studio child 被误清 | child count 优先投影 waiting phase |
| Proxy/CDN 仍强制聚合 | headers + 运维配置；明确不支持的网关边界 |
| 多实例无粘性 | 文档要求 sticky/single-process；不在本任务伪造跨进程 truth |
| 过度扩大到所有 SSE | 只改 Chat route；其它路由另案治理 |

## 回滚

1. 可先停止前端 watchdog/reconcile，保留 anti-buffering headers（低风险）。
2. `connected.state` additive 可保留；旧客户端会忽略。
3. 若 snapshot handshake 有问题，回退 connected state 与 wrapper projection，不涉及数据恢复。
4. 不删除/改写任何 session、task 或 agent data。

## UI Gate

本设计不增加视觉内容，但改变已有 Stop/Send 状态时序，仍按规则触发 HTML prototype gate。原型/用户审批未完成前不得实现。
