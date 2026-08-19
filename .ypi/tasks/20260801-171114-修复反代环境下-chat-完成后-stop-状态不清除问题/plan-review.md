# 计划审批书：修复反代环境下 Chat 完成后 Stop 状态不清除

## 当前审批状态

**暂不可进入 `awaiting_approval`。**

规划材料已完成，但本任务改变现有 Chat Stop → Send 的交互状态收敛，触发 UI Prototype Gate。当前缺少 `ui-designer` 产出的 HTML 原型和用户对原型的明确批准；delegated architect 环境也没有 Studio delegation / `update_implementation_plan` / transition 工具。

主会话下一步必须：

1. 派发 `ui-designer` 产出任务目录内 HTML；
2. 将原型相对链接与用户审批记录补入 [UI](ui.md) 和本文件；
3. 保存 [Implement](implement.md) 中的 `ypi-implementation-plan` 到 task state；
4. 确认本审批书仍与原型一致后，再切到 `awaiting_approval` 请求整体计划批准。

## 审批材料

- [Brief / 现象、代码证据、根因链与边界](brief.md)
- [PRD / R1–R12 与验收标准](prd.md)
- [UI / Prototype Gate、状态清单与当前 blocker](ui.md)
- [Design / handshake、重连补偿、watchdog 与终态幂等](design.md)
- [Implement / 子任务表与 schemaVersion 2 DAG](implement.md)
- [Checks / 自动、反代、断线、Studio 与 UI 验收矩阵](checks.md)

> HTML 原型：[打开 Chat Stop 状态恢复 HTML 原型](chat-stop-recovery-prototype.html)。该原型只确认现有 Stop/Send 的状态时序，不新增按钮、banner、toast、文案或布局。用户需先确认原型，再进入整体计划审批。

## PRD 摘要

1. Chat SSE 响应补齐 `no-cache, no-store, no-transform` 与 `X-Accel-Buffering: no`，降低反代尾帧缓冲。
2. 普通 SSE `connected` additive 增加安全 runtime snapshot：`isStreaming`、`studioChildRunCount`、可选 `isCompacting`。
3. 服务端必须先 subscribe，再同步读取 snapshot，避免检查后订阅窗口。
4. 前端 active 真相是 `state.isStreaming || studioChildRunCount > 0`，不能把 wrapper alive 当作 turn active。
5. 断线/重连和 running-only watchdog 查询权威状态；idle 时补偿丢失 `agent_end`，查询失败时 fail-safe 保持 running。
6. 初始 SSE 可能早于 prompt POST，必须用 connection reason、turn evidence、generation 与保护期避免误清。
7. 真实 `agent_end`、重连 idle、watchdog idle 复用同一幂等终态，每 turn 最多一次 callback/提示音/reload。
8. Studio children、abort、model pin、JSONL、消息内容与现有 UI 视觉保持不变。
9. 运维文档说明反代 streaming 配置、多实例 affinity 和完全不支持 SSE 的网关边界。

## UI Gate 摘要

**触发，尚未完成。** 原型只确认状态时序，不设计新 UI：

| 状态 | 期望 |
| --- | --- |
| Idle | 现有 Send 与 idle controls |
| Running | 现有 Stop / Steer / Follow-up |
| Reconnecting + active | 继续显示现有 Running，不闪 Send |
| Missed end recovered | 自动恢复现有 Send |
| Studio children active | 保持后台运行语义 |

禁止新增恢复按钮、banner、toast、文案、布局或设置项。

## Design 摘要

```text
AgentSessionWrapper safe snapshot
  → /events: subscribe first → connected(state) → future events
  → anti-buffering headers + heartbeat + idempotent cleanup
  → useAgentSession:
       initial/reconnect generation
       + authoritative runtime probe
       + running-only watchdog
       + per-turn converge-end-once
```

关键取舍：

- **不只加 header**：无法覆盖断线期间已经发生、不可重放的 `agent_end`。
- **不只重连**：新连接只订阅 future events。
- **不按固定超时清 Stop**：会误伤慢模型/工具/Studio child。
- **不新增恢复按钮**：应自动与服务端真相收敛。
- **不新建 endpoint**：复用现有 `/api/agent/:id`，但只读 `state.isStreaming` / child count。

## Implementation Plan 摘要

计划 6 个 schemaVersion 2 子任务，`maxConcurrency=2`：

| ID | 内容 | 依赖 |
| --- | --- | --- |
| `UI-00` | UI 设计员 HTML + 用户审批硬门禁 | — |
| `SSE-01` | runtime snapshot、subscribe-first handshake、anti-buffering headers | UI-00 |
| `FE-02` | generation、probe/watchdog、幂等终态 | UI-00 |
| `TEST-03` | proxy/drop/reconnect/Studio/CLI focused tests | SSE-01, FE-02 |
| `DOC-04` | architecture/API/frontend/library/deploy/troubleshooting | SSE-01, FE-02 |
| `CHECK-05` | lint/tsc/diff + 真实反代最终验收 | TEST-03, DOC-04 |

UI gate 后 `SSE-01` 与 `FE-02` 可并行；`TEST-03` 与 `DOC-04` 可并行；`CHECK-05` 是最终 barrier。机器计划内嵌于 [Implement](implement.md)。

## Checks 摘要

```bash
npm run test:agent-sse-recovery
npm run test:ypic-cli
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

必须人工覆盖：

- 本地直连普通/长回复、工具、abort、连续多 turn；
- 真实远程反代；
- 代理放行正文但扣住 `agent_end`；
- 断线期间完成与重连仍 active；
- connect 早于 prompt POST；
- Studio children 后台运行；
- desktop / 375px 与批准 HTML 一致。

关键 blocker：

- 初始 idle snapshot 提前恢复 Send；
- 使用顶层 wrapper `running` 判 activity；
- probe 失败时猜 idle；
- Studio child count 被忽略；
- 同一 turn 重复声音/callback/reload；
- idle 常驻 polling；
- snapshot 泄露路径/内容/凭据；
- 未做真实反代验收。

## 兼容、回滚与剩余风险

- 无 JSONL、配置、session/task schema 或数据迁移。
- `connected.state` additive；旧 Web/CLI 可忽略，运行 `test:ypic-cli` 防回归。
- 可先回滚前端 watchdog/reconcile 而保留低风险 anti-buffering headers。
- 多实例部署仍需要 SSE 与状态查询 session affinity；本任务不新增跨进程 runtime state。
- 完全聚合/不支持 SSE 的网关仍需运维修正，客户端补偿不能创造实时流。

## 待用户决策

### 当前必须决策

请用户先打开并确认 [HTML 原型](chat-stop-recovery-prototype.html)。推荐方向：**无视觉变化，只审批状态时序**。

### 原型审批

请明确回复 **「批准原型」** 或 **「需要修改原型」**。批准表示同意：

- 四层修复：anti-buffering、connected snapshot、重连补偿、running-only watchdog；
- 以 `isStreaming || Studio child count` 为权威 active 判定；
- 每 turn 幂等终态，不新增恢复 UI；
- 自动与真实反代验收矩阵；
- 多实例 affinity / 不支持 SSE 网关为明确剩余部署边界。

## 规划材料索引

- [Brief](brief.md)
- [PRD](prd.md)
- [UI](ui.md)
- [Design](design.md)
- [Implement](implement.md)
- [Checks](checks.md)
