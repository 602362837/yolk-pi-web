# Design

## 方案摘要

新增一个位于 `lib/session-title.ts` 的纯 Studio child 标题格式化 helper，将 step/fallback/50 字符预算集中管理。列表标题和 SDK runner 新建 child 的 `session_info` 都调用它。`projectStudioChildDisplay()` 补全 `subtaskId` 投影并修正缓存键，使同一 task 的多个 child 不会串用 subtask/run 数据。

## 标题契约

输入字段：`subtaskId`、`subtaskTitle`、`member`、`taskTitle`、`runSummary`、`taskId`，以及可选 `maxLength`。

优先级：

1. `subtaskId + subtaskTitle`
2. `subtaskId`
3. `member + taskTitle`
4. `member + runSummary`
5. `member + taskId basename`
6. 现有普通 session fallback

推荐格式化规则：

- 先 collapse whitespace。
- subtask 分支输出 `{id} · {title}`；超长时完整 id 优先，剩余预算给 title。id 本身达到上限时只截断 id。
- subtask 主标题不拼 member；member/status 已在 child badge，run short id 已在 detail/tooltip。
- 无 subtask 分支优先尝试完整 `{member} · {taskTitle}`；若超长，退为截断后的 task title，保证 `标题 > member`。
- helper 最终统一受 `SESSION_TITLE_MAX_LENGTH=50` 约束。

## 影响模块与边界

### `lib/session-title.ts`

- 新增并导出纯 helper（命名由实现员按附近风格确定，例如 `studioChildSessionTitle`）。
- `displayTitleForSession()` 用 `studioChildDisplay.subtaskId ?? studioChild.subtaskId` 和投影标题调用 helper。
- 普通 session 的 `name -> firstMessage -> pending/id` 行为不变。

### `lib/types.ts`

- `StudioChildSessionDisplay` 增加可选 `subtaskId?: string`，作为 UI-only 投影字段。
- 不改变持久化 `StudioChildSessionInfo` schemaVersion；header 已有 `subtaskId`。

### `lib/session-reader.ts`

- `projectStudioChildDisplay()` 返回 `subtaskId`。
- 缓存键从仅 `cwd:taskId` 扩展为至少 `cwd:taskId:subtaskId:runId`。原因是 `subtaskTitle` 依赖 subtask，`runSummary` 依赖 run；这是本次验证发现的现有串投影风险。
- active、archived、单 session detail 都复用该投影，因此存量 session 无需回写。

### `lib/ypi-studio-child-session-runner.ts`

- `studioChildSessionInfoName()` 继续负责读取 task/subtask detail，但不再自行拼字符串；将字段交给共享 helper。
- 推荐让新 `session_info` 直接写共享 helper 的 canonical title；child 身份、member、run id 已存在 header/侧栏详情，不再以另一套 envelope 挤占主标题。
- 读取失败时传入 header/meta 的 `subtaskId/member/taskId`，仍能安全 fallback。

### `components/SessionSidebar.tsx`

- 主渲染继续调用 `displayTitleForSession()`，无需新增状态或交互。
- `studioChildDetailText()` 与 tooltip 保留 run/member/status；可改为优先读取投影 `subtaskId`，但不得重复在主标题之外制造不同 step 规则。

## 数据流

```text
studioChild header(subtaskId/member/taskId/runId)
             + task detail(subtaskTitle/taskTitle/runSummary)
             -> projectStudioChildDisplay()
             -> SessionInfo.studioChildDisplay
             -> shared title helper
             -> displayTitleForSession() -> Sidebar

SDK runner meta + resolved task detail
             -> same shared title helper
             -> appendSessionInfo() for new child JSONL
```

## 兼容性与迁移

- additive optional UI wire field；旧客户端/调用者忽略即可。
- 不新增 JSONL header 字段，不升级 schemaVersion。
- 历史 `session_info` 保持原样，但 UI 在读取时优先使用 header + task 投影，因此即时显示新标题。
- task detail 不存在时仍显示 header `subtaskId` 或 member/taskId fallback。
- CLI runner 若不创建持久 child JSONL，不受 `session_info` 改动影响。

## 风险与缓解

- **缓存串数据**：缓存键纳入 subtask/run identity，并保留现有 TTL/invalidation。
- **长 id 吃满标题**：这是“编号优先”的明确取舍；tooltip/detail 提供完整上下文。
- **同一 step 重跑标题相同**：run short id 仍在 detail/tooltip，不放入主标题；避免牺牲 step/title 可读性。
- **共享 helper 引入循环依赖**：保持 `session-title.ts` 只 type-import `lib/types`，runner 单向导入该纯 helper。
- **持久名称行为变化**：仅新 child；回滚无需数据迁移。

## 回滚

回退共享 helper 调用、投影字段和缓存键改动即可。已写入的新 `session_info` 仍是合法 Pi 记录，无需清理；历史/新 JSONL header 均不变。
