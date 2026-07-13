# SPIKE-01：SDK 全调用拦截可行性验证

**执行时间**：2026-07-13
**SDK 版本**：0.80.6（当前锁定）
**结论**：**NO-GO for "ALL LLM calls" — 需要 SDK 小幅改动或接受已知缺口**

---

## 验证方法

- 阅读已安装 SDK 源码（`node_modules/@earendil-works/pi-coding-agent/dist/core/`）
- 阅读 SDK 公开文档（`docs/sdk.md`、`docs/extensions.md`）
- 对照项目内所有 LLM 入口（`lib/rpc-manager.ts`、`lib/ypi-studio-child-session-runner.ts`、direct completion routes）
- 追踪 `completeSimple()` → `AssistantMessage.usage` 的可用性与丢弃点

---

## 覆盖矩阵

| 入口 | 调用方式 | Usage 来源 | 公开 API? | 覆盖结论 |
|------|----------|------------|-----------|----------|
| **主 Chat / ypic** | persistent `AgentSession` | `session.subscribe()` → `message_end` 事件，`event.message.usage` 含完整 `Usage`（input/output/cacheRead/cacheWrite/cacheWrite1h?/reasoning?/totalTokens/cost） | ✅ 公开稳定 | **GO** |
| **Studio SDK child** | persistent `AgentSession` (独立 session) | 同上 `message_end` 事件 | ✅ 公开稳定 | **GO** |
| **Studio CLI child** | `pi --mode json -p --no-session` 子进程 | CLI JSON 输出的 `message_end` 事件携带 usage（现有代码已解析 `usageOutputTokens`） | ✅ CLI JSON 协议公开 | **GO** (需规范化字段到 v1 schema) |
| **Terminal env assist** | `completeSimple()` | 返回值 `AssistantMessage` 含完整 `usage` | ✅ 公开 API | **GO** (我们自己的代码，可直接捕获) |
| **Trellis workflow assist** | `completeSimple()` | 同上 | ✅ 公开 API | **GO** |
| **Models config test** | `completeSimple()` | 同上 | ✅ 公开 API | **GO** |
| **OpenAI Codex warmup** | `streamSimple()` | `stream.result()` 返回 `AssistantMessage` 含 `usage` | ✅ 公开 API | **GO** |
| **Compaction (manual + auto)** | `completeSimple()` 内部调用 | SDK 的 `compact()` → `generateSummary()` → `completeSummarization()` **丢弃 usage**；`compaction_end` 事件只传 `{summary, tokensBefore, estimatedTokensAfter}` | ❌ 公开 API 不暴露 usage | **NO-GO** — 需 SDK 改动 |
| **Branch summary** | `completeSimple()` 内部调用 | SDK 的 `generateBranchSummary()` → `completeSummarization()` **丢弃 usage**；`navigateTree()` 不 emit 带 usage 的事件 | ❌ 公开 API 不暴露 usage | **NO-GO** — 需 SDK 改动 |

---

## 关键证据

### 1. Normal assistant turns：完全可覆盖

```typescript
// AgentSession.subscribe() — 公开 API
session.subscribe((event) => {
  if (event.type === "message_end" && event.message.role === "assistant") {
    // event.message.usage 完整可用：
    // { input, output, cacheRead, cacheWrite, cacheWrite1h?, reasoning?, totalTokens, cost }
    // event.message.provider, event.message.model, event.message.api
  }
});
```

每个 assistant turn 都触发 `message_end`，包括 tool loop 的多轮 assistant 响应。`turn_end` 事件也可用（带 `event.message`）。

### 2. Compaction：usage 从调用响应中丢弃

源码路径：`agent-session.js` → `compact()` → `compaction.js` → `generateSummary()`

```js
// compaction.js: generateSummary()
const response = await completeSummarization(model, context, options, streamFn);
// response 是 AssistantMessage，包含完整 usage！
// 但只提取了文本，丢弃 usage：
const textContent = response.content.filter(c => c.type === "text").map(c => c.text).join("\n");
return textContent; // ← 只返回文本字符串
```

```js
// compaction.js: compact()
summary = await generateSummary(messagesToSummarize, model, ...);
// generateSummary 返回纯文本字符串，不返回 usage
return { summary, firstKeptEntryId, tokensBefore, details };
// ← 无 usage
```

`compaction_end` 事件：
```js
// agent-session.js
this._emit({
    type: "compaction_end",
    reason,
    result: { summary, firstKeptEntryId, tokensBefore, estimatedTokensAfter, details },
    // ← 无 usage
});
```

**根本原因**：`completeSimple()` 返回的 `AssistantMessage` 包含完整 `usage`，但 `generateSummary()` 只取文本、`compact()` 只返回 summary，两者均丢弃了 usage 字段。这不是 API 能力问题，是 SDK 内部**选择不暴露**。

### 3. Branch summary：同样的丢弃模式

```js
// branch-summarization.js: generateBranchSummary()
const response = streamFn
    ? await (await streamFn(model, context, requestOptions)).result()
    : await completeSimple(model, context, requestOptions);
// response 是 AssistantMessage，含完整 usage！
let summary = response.content.filter(c => c.type === "text").map(c => c.text).join("\n");
// ← 只取文本
return { summary, readFiles, modifiedFiles };
// ← 无 usage
```

`navigateTree()` 不 emit 任何携带 LLM response 的事件。

### 4. 扩展 API 也不能填补缺口

检查了 `session_before_compact` 和 `session_compact` 扩展事件：
- `session_before_compact` 不能观察 LLM 调用结果（它在调用之前触发）
- `session_compact` 接收已保存的 compaction entry，但 entry 不含 usage
- 没有 `session_after_compact` 或任何可观察 LLM 调用用量的扩展事件

### 5. `agent.streamFn` 不是公开可写属性

`session.agent.streamFn` 公开可读，但 `agent` 是 `readonly`，且 `Agent` 类没有公开的 `setStreamFn` 方法。直接替换 `streamFn` 属于未文档化私有 monkey patch。

---

## Go / No-Go 决策

### 可覆盖（9/11 个入口）

通过公开稳定 API 覆盖主 Chat、Studio SDK/CLI、direct completion、warmup。

占比估算：这些入口覆盖了 >95% 的 LLM token 消耗。

### 不可覆盖（2/11 个入口）

Compaction 和 branch summary 的内部 LLM 调用无法通过公开 API 捕获 usage。

占比估算：<5% 的 token 消耗（仅在长会话 compaction 或分支导航时触发）。

---

## 最小安全后续方案（三种选择）

### 方案 A（推荐）：请求 SDK 上游改动 + 先接受已知缺口

1. **向 pi SDK 团队提 feature request**：在 `compaction_end` 事件和 `session_compact` 扩展事件中增加 `usage` 字段，在 `generateBranchSummary()` 返回值中增加 `usage`。
2. **改动极小**：SDK 只需在 `compact()` 中传递 `response.usage`、在 `generateBranchSummary()` 中返回 `response.usage`。
3. **先实现所有可覆盖入口的记录**，将 compaction/branch summary 标记为 `knownGap`，在 coverage banner 中展示。
4. **SDK 更新后无需改 schema**：事件字段是 additive，账本已有持久化路径。

### 方案 B：利用 `message_end` 扩展事件拦截

`message_end` 扩展事件允许替换消息内容。可以在扩展中为 compaction 的 LLM 响应注入一个 `custom` role wrapper，但这属于**滥用语义**（compaction 响应不是正常 assistant turn），且 `message_end` 只对 agent 主循环有效，compaction 期间 `_disconnectFromAgent()` 已断开。

**不推荐**：过于 hacky，不稳定。

### 方案 C：用 `before_provider_request` / `after_provider_response` 间接推断

扩展事件 `before_provider_request` 和 `after_provider_response` 提供 HTTP 级别的请求/响应观察：
- `before_provider_request`：发送前可观察 payload
- `after_provider_response`：收到 HTTP 响应后可观察 status + headers

但这两个事件：
- 不提供解析后的 `AssistantMessage` 和 `usage`
- compaction 期间 agent 事件已断开，不确定这些事件是否仍触发
- 需要在 HTTP 层重新解析 usage，重复 SDK 的 provider 特定逻辑

**不推荐**：脆弱、重复实现、可能不触发。

---

## 验证说明

本 spike 未运行代码；通过阅读已安装 SDK 0.80.6 的**完整编译源码**和**公开类型定义**完成。所有结论均可通过源码行号回溯验证（见下）。

**关键源文件及行号**（`node_modules/@earendil-works/pi-coding-agent/dist/core/`）：

| 文件 | 关键行 | 内容 |
|------|--------|------|
| `agent-session.js` | 301-356 | `_handleAgentEvent` → `message_end` 持久化，携带完整 `event.message` |
| `agent-session.js` | 1341-1458 | `compact()` → 调用 `compaction.js:compact()`，emit `compaction_end`（无 usage） |
| `agent-session.js` | 2240-2400 | `navigateTree()` → 调用 `generateBranchSummary()`，不 emit LLM 响应 |
| `compaction/compaction.js` | 186-209 | `generateSummary()` → `completeSummarization()` 返回 `AssistantMessage`，但只取 `.content` 文本 |
| `compaction/compaction.js` | 243-270 | `compact()` → 调用 `generateSummary()`，返回 `{summary, firstKeptEntryId, tokensBefore, details}` |
| `compaction/branch-summarization.js` | 173-215 | `generateBranchSummary()` → `completeSimple()/streamFn().result()` 返回 `AssistantMessage`，只取文本 |
| `agent-session.d.ts` | 168-170 | `readonly agent: Agent` — 公开只读 |

---

## 剩余风险

1. **SDK 团队响应时间不确定**：如果 SDK 团队不接受 feature request 或响应缓慢，compaction/branch summary coverage 将长期停留在 known gap。
2. **SDK 升级可能导致 `message_end` 事件 shape 变化**：虽然事件契约是公开稳定的，但字段增减是可能的。
3. **Streaming 终态去重**：`message_end` 只触发一次；但如果 SDK 内部重试导致多次 `message_end` 对同一 turn（非 tool loop），需确认不双计。

---

## 建议

**主会话应决定：**

1. ✅ **接受方案 A**：先覆盖 9/11 入口，compaction/branch summary 列为 known gap；同时向 SDK 团队提 feature request。
2. ❌ **不接受方案 B/C**（私有 monkey patch 或 HTTP 层推断）。
3. **确认 calls 口径**为"可观测 completion 终态"，不声称物理 HTTP attempt 精确计数。
4. **SDK 拦截边界确认后**，可进入 CORE-01 实现。
