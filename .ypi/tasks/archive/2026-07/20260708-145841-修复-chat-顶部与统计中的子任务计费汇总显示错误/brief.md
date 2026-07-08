# brief

## 任务摘要

用户反馈：Chat 顶部计费在存在 YPI Studio 子任务 / 子 session 时显示成类似“{金额}+child”的占位文案；打开子 session 时也出现同类显示；同时需要确认 Usage 统计链路是否真的把 Studio child session 的费用汇总到父会话。

## 已读材料

- `docs/architecture/overview.md`：Session child header、Usage accounting、Chat top-bar usage 设计。
- `docs/modules/frontend.md`：`AppShell`、`ChatWindow`、`UsageStatsModal`、`useAgentSession` 分工。
- `docs/modules/api.md`：`/api/usage` 与 `?sessionId=` 契约。
- `docs/modules/library.md`：`lib/usage-stats.ts` 聚合规则。
- `docs/standards/code-style.md`：验证命令与测试约定。
- 相关代码：`components/AppShell.tsx`、`components/ChatWindow.tsx`、`hooks/useAgentSession.ts`、`components/UsageStatsModal.tsx`、`lib/usage-stats.ts`、`app/api/usage/route.ts`。

## 初步定位

1. 顶部费用 chip 在 `components/AppShell.tsx` 中硬编码追加 `+child`，属于占位/调试式文案，用户会理解成“金额 + 未展开 child”，而不是“金额已包含 Studio child”。
2. `hasChildUsage` 目前用 `childCount > 0 || childCost > 0` 判定；即使 child session 只有数量、没有实际 usage，也可能给父会话费用追加 `+child`。
3. `GET /api/usage?sessionId=<child>` 当前按架构会解析回父 session rollup，因此进入 child audit session 时仍会显示父会话 + 所有 child 的口径；如果产品期望 child tab 显示“该 child 自身费用”，需要在 hook/topbar 层明确区分 `selectedSessionKind === "studio_child"`。
4. 全局 Usage 链路代码已经显式 `includeStudioChildren: true` 并生成 `byParentSession`，但缺少面向 Studio child rollup 的回归验证，容易让 UI 文案问题被误判为汇总未生效。

## 建议目标

- 修复顶部 `+child` 占位文案，改为明确且不误导的 compact 文案与 tooltip。
- 明确父 session、standalone session、Studio child session 三种 top-bar 费用口径。
- 保持 Usage 统计结构不大改；通过回归验证确认 `byParentSession` 与 `session_rollup` 真实聚合 child usage。

## UI 原型门禁判断

无需 HTML 原型。理由：本任务只修复既有顶部费用 chip 的错误文案/判定与 usage 汇总口径，不新增页面、不改变布局结构、不改变交互流程、不改变审批/确认体验。若主会话决定把顶部费用区域改成多列拆分或新增展开面板，则应重新触发 UI 设计员 HTML 原型门禁。
