# ui

## UI 原型门禁结论

不触发 UI 设计员 HTML 原型门禁。

依据：本任务修复既有 Chat 顶部费用 chip 的错误文案、判定条件与 usage rollup 口径；不新增页面、不调整布局结构、不新增交互、不改变审批/确认体验。`UsageStatsModal` 如仅验证现有统计口径或修正文案，也不改变信息结构。

## 现有涉及 UI

- `components/AppShell.tsx`
  - 顶部费用 chip 当前显示 total cost，并在 `hasChildUsage` 时追加裸 `+child`。
  - tooltip 已有 source、scope、own cost、Studio children cost 等信息。
- `components/UsageStatsModal.tsx`
  - 总览卡片显示 Studio children 数量与 Parent rollups。
  - Session 列表优先显示 `byParentSession` rollup 行。

## 文案建议

### 父 session

- compact：`$0.03 incl. Studio`（仅当 child 有实际 usage totals）
- tooltip：
  - `scope: current chat + N Studio child sessions`
  - `cost: $0.0300`
  - `own cost: $0.0100`
  - `Studio children cost: $0.0200`

### standalone session

- compact：`$0.03`
- tooltip：`scope: current chat`

### Studio child audit session

推荐口径（需主会话确认）：

- compact：`$0.02 Studio child`
- tooltip 增补：
  - `scope: selected Studio child session`
  - `parent rollup: $0.0300`（如保留/提供 parent rollup totals）

备选口径：如果继续显示 parent rollup，则 compact 至少应为 `$0.03 parent rollup`，tooltip 明确 `selected session is a Studio child; showing parent chat rollup`。

## 不做的 UI 改动

- 不新增 topbar 展开面板。
- 不改变 Usage 弹窗布局。
- 不新增图表、表格列或筛选器。
- 不改变 child audit session 的只读交互。
