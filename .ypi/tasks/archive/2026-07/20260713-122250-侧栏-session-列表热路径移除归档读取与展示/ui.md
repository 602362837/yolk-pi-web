# UI：侧栏移除归档区块

## 门禁结论

**已触发 UI HTML 原型门禁。** 本任务会删除侧栏可见的“已归档 (N)”信息结构、展开交互、归档 session 行与恢复入口；即使没有新增交互，也属于用户可见信息结构和现有交互变化，不能以“仅删除低频入口”为由豁免。

## 派发状态与阻塞

当前 UI 原型已由 `ui-designer` 成功交付：
- [session-sidebar-without-archive-prototype.html](session-sidebar-without-archive-prototype.html) (已交付)

覆盖状态包括：正常 active 列表、移除归档区块后的底端视觉、窄版自适应侧栏、空 active 列表（隐藏已归档，仅显示 No sessions found）、单个与批量归档动作后列表刷新演示、以及修正数量口径后的“归档所有会话”确认弹窗。

## 给 UI Designer 的任务单

先阅读：

- `AGENTS.md`
- `docs/modules/frontend.md`
- `components/SessionSidebar.tsx` 中 header、session list、batch archive bar、archive-all confirm 和 archived section
- 本任务 `brief.md`、`prd.md`、`design.md`

基于当前项目 CSS 变量和侧栏密度制作轻量、可运行 HTML 原型。至少展示：

1. **正常 active 列表**：项目/空间头、session 树、hover 归档按钮和底部文件浏览区域视觉保持现状。
2. **移除结果**：active 列表末尾直接结束，不出现“已归档 (N)”折叠行，也没有 archived row / 恢复按钮。
3. **active 空态**：直接显示“No sessions found in this space”，即使说明数据中存在 archived sessions 也不展示侧栏入口。
4. **单个与批量归档**：入口和操作栏保持现状；成功状态说明 active row 消失并刷新 active 列表。
5. **归档全部确认**：显示“确认归档 N 个当前会话？”；N 仅为当前 active 数量，不包含已经归档的数据。
6. 浅色与深色至少各一关键状态；窄侧栏下标题仍省略且无横向溢出。

## 交互不变量

- 不新增归档入口或替代导航。
- 不改变 active row 的选择、重命名、删除、归档、树层级和 Studio child 展示。
- 不改变归档确认的 destructive/confirmation 风格，只校正数量口径。
- 原型不需要模拟真实 archive API；重点验证信息结构删除后侧栏层级和空态合理。

## 用户审批记录

UI HTML 原型已交付并与计划关联，正等待用户与计划一同审批。在此之前不得进入实现。
