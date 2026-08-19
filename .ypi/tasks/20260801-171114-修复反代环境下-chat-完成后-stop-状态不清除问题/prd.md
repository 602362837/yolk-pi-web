# PRD：Chat SSE 终态可靠收敛

## 目标与背景

远程反代访问时，即使 Chat 回复已完成，浏览器仍可能因未收到 SSE `agent_end` 而持续显示 Stop。目标是在不改变既有 Chat 视觉与正常流式体验的前提下，让前端运行态最终与服务端权威状态一致，并使断线、重连、尾帧缓冲场景可自愈。

## 用户价值

- 回复完成后无需刷新即可继续发送消息。
- 临时网络抖动或反代尾帧缓冲不会永久锁死 Chat 输入区。
- Agent 仍运行或 Studio children 仍在后台工作时，不会错误显示 Send。
- 正常本地直连行为、终止按钮、提示音和 session 刷新语义保持一致。

## 范围内

1. Chat SSE anti-buffering 响应头。
2. 普通 Chat SSE 初始连接的 additive runtime snapshot。
3. Web SSE 断线/重连状态补偿。
4. 仅运行期间启用的有界状态 watchdog。
5. 统一且幂等的前端 turn 完成收敛。
6. focused 自动测试、代理环境人工验收与运维文档。

## 范围外

1. 不修改 ChatInput 的视觉、文案、按钮层级或布局。
2. 不新增“强制恢复”“重新连接”按钮或用户配置。
3. 不修改 Session JSONL、RPC 命令 body、模型/Provider 调用。
4. 不重构其它业务 SSE 路由。
5. 不在本任务中重新设计 `ypic` 重连；只保证 additive wire 兼容和现有 CLI 测试通过。
6. 不以固定时间到达就无条件清 running；超时只能触发权威核对。

## 需求与验收标准

### R1：Chat SSE 必须声明不可缓存、不可转换、不可由 Nginx 缓冲

服务端普通 Chat 与 Studio child audit SSE 统一返回适合 streaming 的 headers，至少包含：

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache, no-store, no-transform`
- `Connection: keep-alive`
- `X-Accel-Buffering: no`

**验收：** route contract test 能读取这些值；Nginx 反代 smoke 中 assistant delta 与终态无需等待缓冲区/连接关闭即可到达。

### R2：SSE 连接必须给出 additive runtime snapshot

普通 Chat `connected` 事件增加可选 `state`，只含浏览器安全字段：

```ts
{
  isStreaming: boolean;
  studioChildRunCount: number;
  isCompacting?: boolean;
}
```

旧客户端忽略新增字段后行为不变。不得包含 sessionFile、cwd、systemPrompt、模型凭据、工具参数或消息正文。

**验收：** 已 idle 的 session 连接得到 `isStreaming=false`；正在运行的 session 得到 `true`；Studio child count 正确；wire 隐私测试通过。

### R3：连接快照与事件订阅必须避免“检查后订阅”窗口

普通流先注册 listener，再同步读取 snapshot 并发送 `connected`；不得先 await GET state 再订阅，从而在两者之间丢 `agent_end`。

**验收：** 测试覆盖“终态发生在连接建立附近”：客户端要么收到 idle snapshot，要么收到后续 `agent_end`，不能两者都错过。

### R4：前端必须区分 wrapper alive 与 turn active

权威 active 判定为：

```text
state.isStreaming === true OR state.studioChildRunCount > 0
```

不得把 `/api/agent/[id]` 顶层 `running=true`（仅表示 wrapper alive）直接映射为 Stop。

**验收：** alive + `isStreaming=false` + child=0 能恢复 Send；alive + child>0 保持后台运行态。

### R5：SSE 断线时必须先核对权威状态，再决定重连或结束

- 若服务端仍 active：保持 Stop 并重连。
- 若服务端已 idle：不等待旧 `agent_end`，走统一完成路径。
- 若状态查询失败：不得猜 idle；保持当前状态并按有界 backoff 重连/重试。

**验收：** 模拟在 `agent_end` 前断流、服务端随后 idle，前端在目标窗口内恢复 Send；状态查询 5xx 时不误清 running。

### R6：重连成功后必须再次应用快照补偿

若 `agent_end` 在断线期间已发生，新连接的 idle snapshot 必须结束旧前端运行态；若仍 active，则继续等待未来事件。

**验收：** “断线 → 服务端完成 → 重连”无需刷新恢复；“断线 → 重连时仍生成中”不闪回 Send。

### R7：连接未报错但尾帧未到时必须有运行态 watchdog

watchdog 只在前端认为 running 时存在，低频查询权威状态；收到活动事件时更新 last-event/turn evidence。它必须：

- 采用 AbortController/generation，session 切换或 unmount 后旧结果不得提交；
- 对首次连流后、prompt 尚未开始的合法 idle 瞬态设置竞态保护；
- 对状态查询失败 fail-safe 保持 running；
- session idle 后立即停止，不形成常驻轮询。

**验收：** 代理保持连接但永久扣住最后一帧时仍能恢复；新 prompt 初始化阶段不会被 watchdog 提前结束。

### R8：正常与补偿终态必须复用一条幂等收敛路径

终态收敛应统一处理：

- `agentRunning` / `agentPhase` / stream reducer / retry 清理；
- session/context/runtime state 刷新；
- usage rollup 触发条件；
- `onAgentEnd`；
- 完成提示音（由既有事件包装路径触发）；
- EventSource/watchdog cleanup。

同一 turn 的真实 `agent_end`、idle snapshot 和 watchdog 不得重复触发完成回调或提示音。

**验收：** 每个 turn 最多一次 `onAgentEnd` / done sound；迟到 `agent_end` 不重复追加消息或完成通知。

### R9：Abort 行为保持兼容

用户在真正 active 时点击 Stop 仍发送现有 abort 命令。若 UI 尚未补偿但服务端已 idle，权威核对会恢复状态；无需新增 abort API。

**验收：** active turn 可中止；abort 后即使 `agent_end` 丢失也能通过 snapshot/watchdog 收敛。

### R10：Studio child 语义不得回归

主模型 turn 结束但 `studioChildRunCount > 0` 时继续显示 `waiting_for_studio_children`，不能切回 idle；child 全部结束且没有新的 continuation streaming 时才结束。

**验收：** 现有 Studio 后台状态测试通过，并新增 snapshot/reconcile 场景。

### R11：UI 视觉保持不变

批准的目标仅为状态正确性：运行中使用现有 Stop，权威 idle 后使用现有 Send。无新文案、按钮、toast、banner、动画或布局。

**验收：** ui-designer HTML 原型获用户批准；实现截图与原型/现状对比无非预期视觉变化。

### R12：文档必须说明代理配置与自愈边界

运维文档需记录：

- 推荐代理关闭 buffering/compression transformation；
- 应透传 streaming；
- 客户端补偿不是对“网关完全不支持长连接/SSE”的替代；
- 排查步骤包含 SSE headers、事件 timing 和 `/api/agent/:id` 中 `state.isStreaming`。

## 非功能要求

- **兼容性：** wire 只做 additive 字段/header 修改；旧 Web/CLI 可忽略。
- **性能：** idle 时零 polling；running 时低频、单飞、可取消。
- **隐私：** snapshot 仅布尔值与数量，不返回路径、正文、prompt、凭据。
- **可靠性：** 查询失败 fail-safe，不通过本地超时猜测完成。
- **可测试性：** 状态判定与补偿决策优先抽成纯函数；测试不依赖真实模型网络。

## 未决问题

### 阻塞项：UI 原型门禁

按 Studio 规则，现有 Stop/Send 交互状态变化触发 UI gate。当前缺少 `ui-designer` 产出的 HTML 原型及用户审批记录，不能进入 `awaiting_approval`。

推荐默认（交给 UI 设计员确认）：**无视觉变更，只批准状态时序**。

### 非阻塞实现参数（计划默认值，实施时由测试校准）

- watchdog 轮询建议 5 秒，首次 optimistic send 设至少 8–10 秒保护期；
- 查询失败使用有界退避，最大间隔 15 秒；
- 心跳保留 30 秒，若真实代理验收显示 idle timeout 更短再调整，不把心跳当终态补偿。
