# Design：独立 LLM 调用账本与统计

## 现状证据

### 当前链路

`GET /api/usage` → `lib/usage-stats.ts` → active/archive session inventory → `SessionManager.open(...).getEntries()` → assistant `message.usage` 聚合。维度已有 day/model/provider/session/parent rollup；`calls` 实际是“带 usage 的 assistant message 数”。

优点是无需额外写入；缺点是读取重、和 session/归档耦合且覆盖不完整。`/api/usage?sessionId=` 还承载 Chat 顶栏 parent/Studio child lifetime rollup 与 child context snapshot，不能在本次全局统计重构中顺手改语义。

### 已知调用入口与当前覆盖

| 入口 | 调用方式 | 当前 Usage | 设计 source |
| --- | --- | --- | --- |
| 主 Chat / ypic | persistent AgentSession | 覆盖 assistant turn | `chat` |
| Studio SDK child | persistent AgentSession | 覆盖 assistant turn | `studio_sdk` |
| Studio CLI child | `pi --mode json -p --no-session` | 不覆盖 | `studio_cli` |
| Terminal env assistant | `completeSimple` + fallback | 不覆盖 | `terminal_env_assist` |
| Trellis workflow assistant | 多候选、结构化/纯文本 `completeSimple` | 不覆盖 | `trellis_workflow_assist` |
| Models config test | `completeSimple` | 不覆盖 | `model_test` |
| Codex warmup | direct `streamSimple` | 不覆盖 | `warmup` |
| compaction | AgentSession 内部 completion，结果只存 summary | 不覆盖 | `compaction` |
| branch summary | AgentSession 内部 completion，结果只存 summary | 不覆盖 | `branch_summary` |

外部 project/user extensions 自行调用 pi-ai 不在仓库可控边界内，coverage 必须声明。

## 方案摘要

建立 `lib/llm-usage-*` 独立模块，以**不可变调用事件**为源，提供 capture、store、query、backfill、coverage 和 legacy adapter。事件不存 LLM 内容。新页面只消费版本化新 API；旧 session rollup 暂不迁移。

### 为什么不是继续扫描 JSONL

扫描无法补齐 direct/hidden calls，也无法让统计独立于归档。JSONL 只适合作为历史 backfill 来源和 session rollup 兼容来源。

### 为什么首期不用单一 JSONL journal

Next 多进程、Studio CLI/SDK 并发与崩溃可能造成跨进程 append/半行问题。首期采用唯一事件文件：写同目录 tmp → fsync（可选）→ 原子 rename，最终文件 `wx`/存在即幂等。它牺牲 inode 数量换取低风险正确性；后续可在不改事件 schema 的前提下增加日索引/压缩。

## 数据模型

建议根目录：`<getAgentDir()>/usage-events/v1/YYYY-MM-DD/<eventId>.json`

```ts
interface LlmUsageEventV1 {
  kind: "yolk-llm-usage-event";
  schemaVersion: 1;
  eventId: string;
  callId: string;
  occurredAt: string;
  completedAt: string;
  status: "success" | "error" | "aborted";
  provider: string;
  requestedModel: string;
  responseModel?: string;
  api?: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cacheWrite1h?: number;
    reasoning?: number; // output 的子集，不重复加总
    totalTokens: number;
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  };
  source: {
    kind: "chat" | "studio_sdk" | "studio_cli" | "terminal_env_assist" | "trellis_workflow_assist" | "model_test" | "warmup" | "compaction" | "branch_summary" | "legacy_session_backfill";
    invocation?: "agent_turn" | "direct_completion" | "maintenance";
  };
  scope?: {
    sessionId?: string;
    parentSessionId?: string;
    studioRunId?: string;
    taskId?: string;
    workspaceKey?: string; // canonical path 的不可逆 hash，不存 path
  };
  provenance: {
    mode: "native" | "backfilled";
    usageSource: "sdk";
    attemptVisibility: "finalized_completion_only";
  };
}
```

约束：所有数字必须 finite、非负；`cost.total` 保留 SDK 当次计算值，不按当前 models.json 重算；不保存 accountId、responseId、prompt/output/path。日期分区按 `occurredAt` 的本地日或 UTC 日必须固定，推荐 UTC，API 再按用户 timezone 聚合。

## 调用语义、重试与流式去重

1. `callId` 在每次 YPI 发起 completion 前创建；最终 `stream.result()` / `completeSimple` message 只调用 recorder 一次。
2. streaming delta、`message_update`、toolcall delta 不写 usage；只认 final AssistantMessage。
3. Agent tool loop 每个 assistant completion 是一条事件。
4. 外层 candidate fallback、Agent auto-retry/account failover每次重新发起 completion均是新 call；即使 error usage 为 0，也记录 failed call。
5. pi-ai 内部 `maxRetries` 的物理 attempts 没有公开逐次 usage；一条 final event 标为 `finalized_completion_only`，不得宣称物理请求精确计数。
6. direct caller 的重复终态回调由相同 eventId 幂等；session backfill 使用 `sha256("session-entry:" + sessionId + ":" + entryId)`。
7. 若 live AgentSession capture 与 backfill 并行，二者必须使用同一 session-entry eventId；若无法在 live 时稳定取得 entryId，则先以“持久化后 tail/backfill”作为 session capture，不建立第二套随机 ID。

## SDK 拦截边界（SPIKE-01）

SDK 0.80.6 会在 `message_end` 后持久化普通 assistant usage，但 `compact()` / `generateBranchSummary()` 返回值不包含 usage。当前 SDK 没有在已读公开文档中承诺全局 completion observer；直接替换 `session.agent.streamFn` 属于未文档化耦合。

实现前必须验证一种稳定路径：

- A（首选）：升级/使用 SDK 的公开 stream decorator/telemetry hook，可给 normal turn、compaction、branch summary 分配 callId 并观察 final message；
- B：向上游补公开 hook并锁定最低 SDK 版本；
- C：产品明确接受 compaction/branch 为 known gap。

**不推荐**在生产代码 monkey patch `_runAgentPrompt`、私有 `_handle*` 或依赖事件发射/持久化的瞬时顺序。

## Store 与查询

- `recordLlmUsageEvent()`：schema normalization、隐私 allowlist、原子唯一写、错误分类；写失败进入进程内有界 retry queue（指数退避、最大次数），最终失败只记 server log/diagnostic，不能阻塞 LLM 响应。
- `queryLlmUsage()`：只扫描日期分区；固定并发、单文件大小上限、损坏隔离、短 TTL single-flight cache；不读取 sessions。
- 可选 `coverage.json`：原子维护 backfill checkpoint、native capture start、known gaps；它是状态元数据，不是事件源。
- 大规模优化后置：日汇总 index 必须可由不可变事件重建，不能成为唯一真相。

## API 契约与兼容

### 新 API

建议 `GET /api/usage/calls?from&to&cwd&provider&model&source&status`，返回：

```ts
{
  kind: "llm_usage_stats";
  schemaVersion: 1;
  range: { from: string; to: string; timezone: string };
  filters: {...};
  totals: UsageTotalsV2;
  byDay: ...[];
  byProvider: Array<{ provider; totals; models: ...[] }>;
  bySource: ...[];
  byStatus: ...[];
  coverage: { nativeSince?; backfill; knownGaps: string[]; corruptEvents; skippedEvents };
}
```

限制日期最大跨度（建议 366 天）和行数；错误消息不带绝对路径。

### 旧 API

- `/api/usage?sessionId=`：首期不变，继续由 session JSONL + Studio runtime context 提供顶栏数据。
- 全局 `/api/usage`：Phase 1 保持 legacy；Phase 2 可加 `source=session|ledger|compare` 仅内部使用；Phase 3 UI 改用 `/api/usage/calls`。
- `usage.includeArchived`：只控制 legacy API/backfill 范围，不影响 ledger 查询；新配置字段若加入，应是 `usage.statsSource: legacy|ledger` 和只读 rollout，不应让保存旧 pi-web.json 失败。

## 迁移

1. 首次/显式 backfill 遍历 active + archive lightweight inventory，打开单 session，读取 assistant usage。
2. 一条 assistant entry 对应一条 deterministic event；可重复、可中断、可恢复。
3. 无 entry timestamp/usage/provider/model 的记录：隔离/unknown，绝不估算。
4. historical direct/CLI/compaction/branch 调用无法恢复，写入 coverage known gap。
5. backfill 不改 session JSONL，不删除 archive，不改变 parent/child 关系。

## 失败与回滚

- **写失败**：LLM 主功能成功不因统计失败而失败；有界重试并暴露 coverage degradation。
- **读失败**：单事件隔离；API 可返回 partial + diagnostics，不因一个坏文件 500。
- **切换失败**：UI/API 回退 legacy；停止 recorder 即可，账本保留只读。
- **代码回滚**：移除新 route/recorder，旧 `/api/usage` 与 topbar 仍工作。
- **数据回滚**：无需；事件目录是 additive。用户确认后可手工移走目录，但实现不得自动删除。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 隐式 SDK 调用漏记 | SPIKE-01；公开 hook 或明确 known gap，拒绝私有 monkey patch |
| 双计 | deterministic eventId、终态写入、session live/backfill 同键 |
| reasoning 重复计 token | schema 注明 subset；total 使用 SDK totalTokens |
| 多进程冲突/半写 | 一事件一文件、tmp+rename、唯一创建 |
| inode/扫描增长 | 日期分区、范围上限、TTL cache；后置可重建日索引 |
| 费用与 Provider 账单不一致 | 显示“SDK estimated cost”；不重算、不承诺账单一致 |
| workspace path 隐私 | 只存 canonical hash；API 用当前 cwd 计算 hash 过滤 |
| UI 把不完整历史显示为 0 | coverage banner 与 completeSince，checker 人工验收 |
