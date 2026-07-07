# Brief — 完善 Usage 统计以纳入 Studio 子代理消耗并轻量增强顶部计费

## 目标

在不把 YPI Studio child transcript / usage 明细注入父聊天上下文的前提下，让 Usage 统计和 Chat 顶部当前会话计费都能看见持久化 Studio child sessions 的 token/cost 消耗，并支持按 parent session 归并。

## 阅读依据

已阅读并对齐：

- `AGENTS.md` 项目契约和文档更新规则。
- `docs/architecture/overview.md`：YPI Studio child session header、父会话关系、上下文最小化约束。
- `docs/modules/api.md`：`/api/usage`、sessions、Studio routes 的职责。
- `docs/modules/frontend.md`：`UsageStatsModal`、`ChatWindow`、`AppShell` 顶部统计职责。
- `docs/modules/library.md`：`lib/usage-stats.ts`、`session-reader`、Studio child session runner 职责。
- `docs/standards/code-style.md`：lint/tsc 与文档同步规则。
- 相关源码：`lib/usage-stats.ts`、`app/api/usage/route.ts`、`components/UsageStatsModal.tsx`、`hooks/useAgentSession.ts`、`components/ChatWindow.tsx`、`components/AppShell.tsx`、`lib/session-reader.ts`、`lib/session-header-metadata.ts`、`lib/ypi-studio-child-session-runner.ts`、`lib/types.ts`。

## 当前状态

- `/api/usage` 通过 `getUsageStats()` 扫描 session JSONL 中 assistant message 的 `usage` 字段。
- `getUsageStats()` 当前调用 `listAllSessions()` 默认会过滤 `studioChild`，因此 YPI Studio SDK child sessions 不参与 Usage 汇总。
- `UsageStatsModal` 只展示总量、按日/模型/供应商/session 拆分，未说明是否包含 Studio child sessions，也没有 parent rollup。
- Chat 顶部 token/cost 来自 `useAgentSession` 对当前 `messages` 的本地累加；它不会也不应该读取 child transcript，因此缺少 Studio 子代理消耗。
- SDK Studio child runner 会创建带 `studioChild` header 的持久 JSONL session；CLI fallback 当前使用 `--no-session`，没有可复用的标准 session usage 记录。

## 方案定位

采用“方案 A + A+”：

1. **方案 A**：让 `lib/usage-stats.ts` / `/api/usage` 默认纳入带 `studioChild` header 的 YPI Studio child sessions，并新增 `byParentSession` parent rollup。
2. **方案 A+**：Chat 顶部当前 session cost 通过后台 usage API 查询 `parent + studio children` 汇总；父聊天 `messages` 不注入 child transcript、child message 或 usage 明细。

## 范围边界

范围内：

- 活跃/归档 session 扫描均可选择包含 Studio child sessions，遵循现有 `usage.includeArchived` 设置。
- 按 `studioChild.parentSessionId` 将 child session usage 归并到 parent session。
- `/api/usage?sessionId=...` 提供轻量 session rollup，供 Chat 顶部使用。
- Usage 弹窗展示/说明包含子代理消耗，并优先展示 parent rollup。
- 更新 API/frontend/library/architecture 相关文档。

范围外：

- 不解析 `.ypi/.runtime/studio-subagents/*.jsonl` transcript sidecar 来估算 cost。
- 不为 CLI `--no-session` child run 反推 usage/cost；除非未来 CLI runner 持久化标准 usage。
- 不改变 Studio workflow/task 状态机、approval gate、subagent runtime。
- 不改变父 session JSONL 内容，不向父聊天上下文追加 child usage 明细。

## 推荐决策

- 在现有 `/api/usage` 增加 `sessionId` 查询分支，而不是新建 route：`GET /api/usage?sessionId=<id>` 返回当前 session rollup；没有 `sessionId` 时保持原聚合接口但扩展字段。
- `UsageStatsResult.bySession` 保留“单个 JSONL session”维度；新增 `byParentSession` 作为 parent 归并维度，避免破坏旧消费者。
- 顶部统计以 API rollup 为准，本地 `messages` 累加仅作为加载中/失败 fallback。

## 未决问题

无阻塞问题。需主会话确认是否接受上述 API 形态（复用 `/api/usage?sessionId=...`）后进入实现。