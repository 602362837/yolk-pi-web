# PRD — Usage 纳入 YPI Studio child sessions

## 目标与背景

YPI Studio SDK 子代理会创建独立的 child session JSONL，并在 header 中写入 `studioChild.parentSessionId` 等审计元数据。当前 Usage 弹窗和 Chat 顶部费用只统计普通父聊天 session，导致 Studio 子代理消耗不可见。本任务要在保持父聊天上下文干净的前提下，让统计可见、可归并、可解释。

## 范围内

- `/api/usage` 全局/按 cwd 聚合纳入 YPI Studio child session JSONL。
- 聚合结果提供 parent session rollup，能看到父会话自身 + 关联 Studio child sessions 的合计。
- Chat 顶部当前 session token/cost 通过后台 API 获取 parent rollup。
- `UsageStatsModal` 明确说明统计包含 Studio child sessions，并展示 child/session 归并信息。
- 文档更新。

## 范围外

- 不把 child transcript、child messages、child usage 明细注入父 session `messages`。
- 不扫描/估算 CLI `--no-session` child runner 的 sidecar transcript cost。
- 不改变 Pi session JSONL schema；只读取现有 `studioChild` header。
- 不新增计费模型价格配置或 cost 计算逻辑；仍使用 assistant message 已持久化的 `usage.cost.total`。

## 用户价值

- 用户在 Usage 弹窗中看到真实 Studio 工作流消耗，不再低估费用。
- 用户在当前 Chat 顶部看到父会话 + Studio 子代理的轻量合计，不需要展开任务或读取 child transcript。
- 父聊天上下文保持最小，避免为了显示费用而增加模型上下文污染。

## 需求与验收标准

### R1. Usage 聚合包含 Studio child sessions

- `lib/usage-stats.ts` 扫描 active sessions 时使用 `includeStudioChildren: true`。
- `usage.includeArchived=true` 时，归档 child sessions 也能被扫描；归档 session reader 需解析并保留 `studioChild` metadata。
- child usage 与普通 session 一样按 assistant message `usage` 累加。

验收：存在带 `studioChild.parentSessionId` 的 child session 且有 usage 时，`/api/usage` totals 增加，`matchedStudioChildSessions > 0`。

### R2. 按 parent session 归并

- 新增 `byParentSession`：每行代表 parent rollup。
- parent rollup 至少包含 `totals`、`ownTotals`、`studioChildTotals`、`studioChildSessionCount`、parent session 基础展示信息。
- child 按 `session.studioChild.parentSessionId` 归并；找不到 parent 文件时仍输出 orphan/unresolved parent row，不丢失 child usage。

验收：父会话自身 cost `$A`，两个 child cost `$B/$C` 时，对应 `byParentSession` totals 为 `$A+B+C`，child count 为 2。

### R3. Chat 顶部费用轻量增强

- 当前聊天打开后，前端通过后台 API 查询 `sessionId` 的 parent + child rollup。
- 顶部 token/cost 使用 API rollup；API 失败或加载中可回退当前 `messages` 本地统计。
- Tooltip 或轻量文本说明包含 Studio child sessions，并展示 child session 数/child cost。
- 不向 `messages`、父 session context、SSE transcript 注入 child 明细。

验收：打开含 Studio child sessions 的父聊天，顶部 cost 包含 child cost；浏览器 React state 中的 `messages` 仍只来自父 session。

### R4. Usage 弹窗说明与展示

- Modal 标题/说明显示“包含 YPI Studio child sessions（如存在）”。
- 顶部 metrics 增加或改写 child session / parent rollup 信息。
- Sessions 列表优先展示 parent rollup，并标注 child 数和 child cost；旧 `bySession` 保留为数据结构兼容。

验收：用户能从弹窗理解统计口径，不会误以为 child 是独立重复计费或未计入。

### R5. 文档同步

- 更新 `docs/modules/api.md` `/api/usage` 描述。
- 更新 `docs/modules/library.md` `lib/usage-stats.ts` 和必要的 `session-reader` 描述。
- 更新 `docs/modules/frontend.md` `UsageStatsModal`、`ChatWindow`/`AppShell` 顶部统计描述。
- 必要时更新 `docs/architecture/overview.md` 中 child session usage 归并边界。

验收：文档描述与代码契约一致。

## 未决问题

- 推荐复用 `/api/usage?sessionId=<id>` 作为顶部 rollup API；主会话若偏好新增 `/api/usage/session` 子路由，需要实现前确认。