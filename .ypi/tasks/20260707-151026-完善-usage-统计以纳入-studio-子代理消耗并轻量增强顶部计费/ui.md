# UI — Usage / Chat 顶部计费轻量增强

## 是否需要 UI 设计员

不需要单独 UI 设计员。此任务是现有 Usage 弹窗和顶部统计的轻量信息增强，不涉及新页面、复杂交互或视觉体系变更。

## 页面 / 组件影响

### `components/UsageStatsModal.tsx`

目标：让用户明确 Usage 已包含 YPI Studio child sessions，并能按 parent session 理解消耗。

建议改动：

- 标题区域增加一句小字说明：`Includes YPI Studio child sessions when present; Studio children are rolled up to their parent chat.`
- Metrics 区保留 Cost/Tokens/Calls/Sessions/Scanned/Matched，新增或替换一个指标：
  - `Studio children`: `matchedStudioChildSessions`
  - `Parent rollups`: `byParentSession.length`
- `Sessions` 区改为优先渲染 `stats.byParentSession`：
  - 标题：`Parent sessions` 或 `Sessions (parent rollup)`。
  - 每行主标题使用 parent `name || firstMessage || parentSessionId`。
  - 副标题显示 `cwd`，并在末尾追加 `+N Studio child`。
  - 右侧 tokens/cost 使用 rollup `totals`。
  - 若 `studioChildTotals.cost > 0`，可在副标题或 tooltip 中展示 `children: $x.xx`。
- 若旧响应没有 `byParentSession`，fallback 到现有 `bySession` 渲染。

### `components/AppShell.tsx` 顶部统计

目标：保持轻量，不新增重型面板。

建议改动：

- 继续展示 input/output/cache/cost 的紧凑 chips。
- 当 API rollup 包含 child sessions 时：
  - cost/tokens 使用 rollup totals；
  - tooltip 增加：`scope: current chat + N Studio child sessions`、`own cost`、`Studio children cost`；
  - 可在 cost 后加很短的 `+child`/`+子` 标记，或仅 tooltip 说明，避免顶部拥挤。
- API 加载中保持当前本地 stats，不显示骨架屏。
- API 失败时不弹 toast，只回退本地 stats；tooltip 可不显示 child scope。

### `hooks/useAgentSession.ts` / `components/ChatWindow.tsx`

目标：后台查询 usage rollup，但不污染聊天消息。

建议改动：

- 在 hook 中维护 `sessionUsageRollup` 状态，基于 `effectiveSessionId` fetch `/api/usage?sessionId=...`。
- `sessionStats` 输出结构扩展 own/child/total 字段；`ChatWindow` 继续通过 `onSessionStatsChange` 上送 AppShell。
- 本地 `messages` 累加保留为 fallback，不读取 child transcript，不 append child messages。

## 状态与交互要点

- 打开普通 session：顶部显示当前 session usage；若无 child，视觉基本不变。
- 打开 Studio parent session：顶部显示 parent + child 合计；tooltip 说明 child 数和拆分。
- 打开 Studio child audit session：推荐 API 将其归一到 parent rollup；若找不到 parent，则显示该 child 自身 usage 并标注 unresolved parent（可仅 tooltip）。
- Usage 弹窗按日期/cwd 筛选时，child sessions 跟随同样日期/cwd/archive 口径。

## 不需要原型化的问题

- 不需要新增图表类型。
- 不需要设置开关；包含 Studio child sessions 应成为 Usage 的默认真实口径。
- 不需要在 Chat 中展示 child usage 明细列表，避免顶部变重。