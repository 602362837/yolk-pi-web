# SPIKE-01：Studio child 上下文 snapshot 来源

Status: complete  
Date: 2026-07-13  
Scope: 只读代码路径验证；不实现 UI，不改计费口径。

## 结论摘要

| 问题 | 结论 |
| --- | --- |
| 活跃 SDK child 是否有权威 `getContextUsage()`？ | **有。** 与父 Chat 相同，来自 pi `AgentSession.getContextUsage()`。 |
| 当前是否已暴露给顶栏/usage rollup？ | **否。** child session 不进 `__piSessions`；runtime handle 只存 `progress.tokens/tps`，那是输出吞吐，不是 context occupancy。 |
| 终止后是否仍有权威 snapshot？ | **默认没有。** `finish()` 会 `dispose()` session 并 `unregisterYpiStudioChildRun`；无 bounded context sidecar。 |
| 能否用 lifetime usage 推算？ | **禁止且错误。** `getSessionStats()` 聚合含 compaction 历史的 billed tokens；`getContextUsage()` 基于当前 branch 的 live messages / 最近 assistant usage。 |
| 推荐数据路径 | **A：additive 扩展现有 `GET /api/usage?sessionId=` rollup**，仅合并 runtime 预计算的 bounded snapshot；usage-stats 不直接持有 AgentSession。 |
| 不可用降级 | UI 显示“暂无上下文数据”；`availability: "unavailable"`；lifetime tokens/cost 只能作为明确标注次要信息。 |

## 1. 权威来源函数 / 字段

### 1.1 父 / 当前选中 Session（已有）

```text
AgentSessionWrapper.handleRpc("get_state")
  -> this.inner.getContextUsage()
  -> { percent, contextWindow, tokens } | null
  -> ChatWindow / useAgentSession.contextUsage
  -> AppShell 顶栏上下文
```

代码：

- `lib/rpc-manager.ts` `case "get_state"`：调用 `this.inner.getContextUsage()`。
- `lib/pi-types.ts`：`AgentSessionLike.getContextUsage(): ContextUsage | undefined`。
- `hooks/useAgentSession.ts`：从 agent state / SSE 写入 `contextUsage`。

### 1.2 pi SDK 语义（权威定义）

`@earendil-works/pi-coding-agent` `AgentSession.getContextUsage()`：

1. 需要当前 `model` 与 `model.contextWindow > 0`，否则 `undefined`。
2. 若存在 latest compaction，且之后没有有效 assistant usage，返回  
   `{ tokens: null, contextWindow, percent: null }`（占用未知，但窗口已知）。
3. 否则用 `estimateContextTokens(this.messages)` 估当前上下文 tokens，再算 percent。

因此权威性依赖 **live AgentSession 内存中的 messages + 当前 model**，不是 JSONL lifetime totals。

### 1.3 Studio child SDK runner（潜在 live 源）

文件：`lib/ypi-studio-child-session-runner.ts`（计划里的 `ypi-studio-subagent-sdk-runner.ts` 不存在，实际为此文件）。

活跃路径：

```text
runYpiStudioSdkChildSession
  -> SessionManager.create(...)
  -> createAgentSessionFromServices(...)
  -> session = result.session   // 本地变量，未注册 __piSessions
  -> registerYpiStudioChildRun({ childSessionId, childSessionFile, progress, ... })
  -> session.prompt(...)
  -> finish(): session.dispose(); unregisterYpiStudioChildRun(runId)
```

- 真实 session 对象具备 `getContextUsage()`（SDK `agent-session.d.ts`）。
- 本地 TypeScript 注解目前只声明了 `prompt/abort/dispose/subscribe/sessionId/sessionFile/messages`，**未包含 `getContextUsage`**，所以今天没有调用点。
- child 不进入 `globalThis.__piSessions`，父会话无法通过 `getRpcSession(childSessionId)` 读取 live child。

### 1.4 明确不是 context occupancy 的字段

| 字段 | 含义 | 可否当 context % |
| --- | --- | --- |
| `YpiStudioSubagentRunProgress.tokens` / `tps` | 输出 token 吞吐（usage 或 chars 估算） | **否** |
| `UsageTotals` / rollup `childSessions[].totals` | lifetime billed input/output/cache/cost | **否** |
| `getSessionStats().tokens` | 全历史聚合（含 compaction 前） | **否** |
| `getContextUsage()` | 当前上下文窗口占用 | **是** |

## 2. 活跃 vs 终止 child 行为

### 活跃 SDK child

| 项 | 现状 | DATA-01 可行改动 |
| --- | --- | --- |
| AgentSession | 进程内 live，runner 闭包持有 | 在 `handleEvent` / `emitProgress` 低频调用 `session.getContextUsage()` |
| Runtime handle | `childSessionId`、`progress` 等 | additive 增加 `contextUsage?: BoundedSnapshot` |
| 投影 | `projectYpiStudioRuntime` 已有只读投影先例，且故意省略 content | 新增按 `childSessionId` / parent 的 bounded context projection |
| 刷新 | progress 随事件更新 | snapshot 随 progress 节流更新（见 §7） |

### 活跃 CLI child / SDK→CLI fallback

- CLI 路径：`spawn` 外部 pi 进程，**无** in-process `AgentSession`。
- 结论：context snapshot **不可得** → `availability: "unavailable"`。
- 不得从 CLI progress tokens 推算。

### 终止 / archived child

| 项 | 现状 |
| --- | --- |
| AgentSession | `dispose()`，内存 messages 丢失 |
| Runtime registry | `unregisterYpiStudioChildRun` 删除 handle |
| Disk | 有 child JSONL + usage entries；**无** context occupancy sidecar |
| 重开 AgentSession 再算 | 技术上可能但重、有副作用风险，**SPIKE 不推荐作为顶栏路径** |

首版行为：

- 终止后无 last snapshot → `unavailable` + UI“暂无上下文数据”。
- 可选后续（非 SPIKE 强制）：finish 前写入 process-local lastKnown map 或 bounded sidecar（仅 percent/tokens/window/capturedAt/status），`source: "persisted"`。  
  **未经额外审查不写 task.json 高频进度，不写 JSONL header。**

### 用户打开 child audit Session

- 走普通 web session start → 进入 `__piSessions` → 顶栏“当前 Session”可复用既有 `contextUsage`。
- 这只覆盖 **selected session**，不替代 parent 浮窗中的 children 列表投影。

## 3. 推荐路径：A（additive rollup），非 B

### 选择 A 的理由

1. 顶栏已请求 `GET /api/usage?sessionId=`（`useAgentSession` 在 agent idle 时拉取 + 30s 轮询）。
2. `UsageSessionRollupResult.childSessions[]` 已有 child 元数据 + lifetime totals；additive 加 `contextUsage?` 零迁移。
3. usage 模块只需 **合并预计算数字**，不必 import `rpc-manager` / 创建 AgentSession。
4. 依赖方向可保持浅：

```text
ypi-studio-child-session-runner  --writes-->  runtime handle.contextUsage
usage-stats /api/usage           --reads--->  projectChildContextSnapshots()
hooks/useAgentSession            --passthru-> SessionUsageTopbarStats.childSessions
```

5. 旧客户端忽略新字段即可；计费字段语义不变。

### 何时改选 B

仅当出现以下情况再改独立 `GET /api/sessions/[id]/context-usage?includeStudioChildren=1`：

- usage 扫描与 runtime 投影刷新节奏必须分离；或
- usage-stats 被强制引入 AgentSession / Studio 深层依赖。

**禁止 A+B 双路径。** 当前证据支持 A。

### 不选的错误路径

- 用 `progress.tokens` / `UsageTotals` 算 percent。
- 为每个 child 在 rollup 时 `createAgentSession` / open JSONL 重算。
- 把 child transcript / prompt / path 塞进 usage 响应。

## 4. 建议契约语义

```ts
type SessionContextUsageSnapshot = {
  percent: number | null;
  contextWindow: number | null;
  tokens: number | null;
  /** available: 有权威读数（percent 仍可为 null）；unknown: 预留/窗口未知等；unavailable: 无权威源 */
  availability: "available" | "unknown" | "unavailable";
  source: "live" | "persisted";
  capturedAt?: string; // ISO
};

// additive on UsageSessionSummary / topbar child summary
contextUsage?: SessionContextUsageSnapshot;
```

### source

| 值 | 含义 |
| --- | --- |
| `live` | 来自当前进程内 SDK child `getContextUsage()` 投影 |
| `persisted` | 来自明确 bounded sidecar / 安全元数据（首版可不实现） |

### availability

| 值 | 条件 | UI |
| --- | --- | --- |
| `available` | 成功调用 `getContextUsage()` 且返回对象；`percent`/`tokens` 可为 `null`（如 compaction 后未知） | 有 window 时显示 `?% / window` 或具体 %；**不得显示 0% 冒充正常** |
| `unknown` | 预留：例如只有元数据、读数语义不清 | “暂无上下文数据”或等价 unknown 态 |
| `unavailable` | 无 live session、CLI child、终止且无 snapshot、模型无 contextWindow 导致完全无读数 | “暂无上下文数据” |

映射建议：

- `getContextUsage() === undefined` → `unavailable`（或仅 window 缺失时 unavailable）。
- `{ percent: null, tokens: null, contextWindow: N }` → `available` + null occupancy（unknown percent，非 0）。
- 无 handle / CLI / disposed → `unavailable`。

### capturedAt

- live 更新时写 ISO 时间。
- UI 可不展示；用于 stale 诊断与后续 checker。

## 5. 不可用降级

1. API：字段缺失或 `availability: "unavailable"` 均可；UI 统一“暂无上下文数据”。
2. 不得把 missing 当成 `0%` / 正常绿态。
3. lifetime `totals` 可在 child 行作为 **次要、明确标注** 信息（“累计 usage”），与 context 分区隔离。
4. parent 自身 `contextUsage` 与费用 rollup **不因 child unavailable 失败**。
5. standalone / 无 children：不渲染 children 列表即可。

## 6. 隐私边界

响应 / 投影 **允许**：

- `sessionId`、`member`、`subtaskId`、`status`、run 关联 id（若已有）
- `percent` / `tokens` / `contextWindow` / `availability` / `source` / `capturedAt`
- lifetime totals（既有 usage 字段）

响应 **禁止**：

- prompt、assistant text、tool args/results、artifact 正文
- `childSessionFile` / 本机绝对路径
- transcript preview / `lastTextPreview`
- system prompt

既有 `projectYpiStudioRuntime` 已示范“只投 ids/status/runner/timestamps”。child context projection 应同样 bounded。

## 7. 刷新频率建议

| 层 | 建议 |
| --- | --- |
| SDK runner 写入 snapshot | 在已有 progress 事件路径节流更新（例如随 `emitProgress`，或 tool/assistant 边界），**不要**每 token 写盘 |
| API 读取 | 跟随现有 session rollup：agent 结束后立即拉 + **30s** interval（`useAgentSession`） |
| 顶栏 | 不新增全局高频轮询；不写 task.json 高频进度 |
| 终止 | 一次 last snapshot（若做）后停止；否则 unavailable |

活跃 child 在 parent idle 时仍可被 30s rollup 读到 runtime map 中的最新 live snapshot，足够顶栏风险识别。

## 8. DATA-01 最小实现建议（供下一子任务）

1. **Runner（写）**  
   - `lib/ypi-studio-child-session-runner.ts`：扩展 session 类型含 `getContextUsage?: () => ContextUsage | undefined`。  
   - 在 progress 更新处调用并 `updateYpiStudioChildRun(runId, { contextUsage: bounded })`。  
   - CLI 路径不写 snapshot。

2. **Runtime（读投影）**  
   - `lib/ypi-studio-subagent-runtime.ts`：handle 增加 optional snapshot；导出  
     `projectYpiStudioChildContextUsageBySessionIds(ids: string[]): Map<string, Snapshot>`  
     只返回数字与 availability，不返回 path/content。

3. **Rollup（合并）**  
   - `lib/usage-stats.ts` `getUsageStatsForSessionRollup`：对 `childSessions[]` additive 附 `contextUsage`。  
   - **不要**改变 totals / selectedSessionKind / 费用口径。  
   - 动态 import 或轻量 import runtime 投影；禁止 import `rpc-manager`。

4. **Hook 透传**  
   - `SessionUsageTopbarStats` additive `childSessions?`（含 snapshot）。  
   - 保持 AbortController + effectiveSessionId race guard。

5. **首版终止策略**  
   - unavailable 即可（产品/design 已允许）。  
   - 若低成本：finish 前保留 process-local lastKnown（仍标 `source: "live"` 或后续 sidecar 再标 `persisted`）。

## 9. 验证记录

### 代码路径证据

- [x] 父 session：`rpc-manager` `get_state` → `inner.getContextUsage()`。
- [x] SDK API：`agent-session.js` / `.d.ts` 证明 occupancy 基于 live messages + model window。
- [x] Child SDK：`ypi-studio-child-session-runner.ts` 创建独立 session，不注册 `__piSessions`，finish dispose+unregister。
- [x] Progress tokens ≠ context：`YpiStudioSubagentRunProgress.tokens` 来自 output usage/chars。
- [x] Rollup：`childSessions` 仅 lifetime usage + studioChild metadata。
- [x] 依赖：`usage-stats` 当前不依赖 runtime/rpc；适合只读合并投影。
- [x] 顶栏刷新：`/api/usage?sessionId=` + 30s / agent-end。

### 未能做的运行时对照

- 本 worktree 无本地 `node_modules`，未启动真实活跃/完成 child 做运行时取样。
- 静态路径已足以锁定来源与降级；DATA-01 应用 1 个活跃 SDK child + 1 个完成 child 做响应抽查。

### 计费口径

- SPIKE **未修改**任何 usage totals 计算或展示代码。

## 10. 风险与给主 Session 的决策点

| 风险 | 处理 |
| --- | --- |
| CLI child 永远 unavailable | 接受；UI 诚实降级 |
| 历史 child 无 snapshot | 首版 unavailable；可选后续 sidecar |
| usage→runtime 耦合 | 仅读 bounded projection；过深则改 Path B |
| live percent 在 compaction 后为 null | 按 unknown occupancy 展示，不是 0% |
| 文件名漂移 | 实现时用 `ypi-studio-child-session-runner.ts` |

**需要主 Session / 产品确认（若尚未在 UI 审批中覆盖）：**

1. 首版终止 child 全部 `unavailable` 是否可接受（推荐：是）。  
2. 是否授权 DATA-01 在 SDK runner 中增加 **内存-only** last snapshot（进程重启后仍 unavailable），或坚持 live-only。  
3. Path A 批准后进入 DATA-01；不要并行开独立 context endpoint。

## 11. 给 DATA-01 的一句话

> 在 SDK child runner 用权威 `session.getContextUsage()` 写入 runtime bounded snapshot；`GET /api/usage?sessionId=` 的 `childSessions[]` additive 合并该投影；CLI/终止/无快照一律 unavailable；禁止 lifetime usage 推算 context。
