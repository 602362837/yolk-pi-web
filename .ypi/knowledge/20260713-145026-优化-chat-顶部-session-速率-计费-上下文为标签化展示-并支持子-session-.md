# 优化 Chat 顶部 session 速率/计费/上下文为标签化展示，并支持子 session 悬停浮窗

- Task: 20260713-134601-优化-chat-顶部-session-速率-计费-上下文为标签化展示-并支持子-session-
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260713-134601-优化-chat-顶部-session-速率-计费-上下文为标签化展示-并支持子-session-
- Archived at: 2026-07-13T06:50:26.491Z
- Tags: studio, feature-dev

## Summary
## SPIKE-01 complete Artifact: [`spike-child-context.md`](spike-child-context.md) ### Decision for DATA-01 - **Path A** only: additive `contextUsage` on existing `GET /api/usage?sessionId=` / `childSessions[]`. - Authoritative live source: SDK child `AgentSession.getContextUsage()` captured into runtime handle (not `__piSessions`). - CLI / terminated / missing snapshot → `availability: "unavailable"` + UI “暂无上下文数据”. - Never derive context occupancy from lifetime usage or `progress.tokens/tps`. - Actual runner file: `lib/ypi-studio-child-session-runner.ts` (not `ypi-studio-subagent-sdk-runner.ts`). ### Not done in this subtask - No production DATA-01 / UI-02 implementation. - No live process sampling (worktree has no local `node_modules`). ### Open product choices 1. Accept terminated children as unavailable in v1? 2. Optional process-local lastKnown snapshot before unregister (still los…

## Reusable knowledge
### handoff.md

# handoff

## SPIKE-01 complete

Artifact: [`spike-child-context.md`](spike-child-context.md)

### Decision for DATA-01

- **Path A** only: additive `contextUsage` on existing `GET /api/usage?sessionId=` / `childSessions[]`.
- Authoritative live source: SDK child `AgentSession.getContextUsage()` captured into runtime handle (not `__piSessions`).
- CLI / terminated / missing snapshot → `availability: "unavailable"` + UI “暂无上下文数据”.
- Never derive context occupancy from lifetime usage or `progress.tokens/tps`.
- Actual runner file: `lib/ypi-studio-child-session-runner.ts` (not `ypi-studio-subagent-sdk-runner.ts`).

### Not done in this subtask

- No production DATA-01 / UI-02 implementation.
- No live process sampling (worktree has no local `node_modules`).

### Open product choices

1. Accept terminated children as unavailable in v1?
2. Optional process-local lastKnown snapshot before unregister (still lost on restart)?

---

## DATA-01 complete

### What shipped

Path A additive child context projection end-to-end (no UI chips):

1. **SDK runner write path** (`lib/ypi-studio-child-session-runner.ts`)
   - Samples `session.getContextUsage()` on progress (2s throttle) and force on finish.
   - Writes bounded snapshot onto runtime handle via `updateYpiStudioChildRun`.
   - CLI path unchanged (no snapshot).

2. **Runtime projection** (`lib/ypi-studio-subagent-runtime.ts`)
   - `YpiStudioChildContextUsageSnapshot` + handle.contextUsage.
   - Process-local `lastKnown` by childSessionId (survives unregister within process; lost on restart).
   - `projectYpiStudioChildContextUsageBySessionIds`, `toYpiStudioChildContextUsageSnapshot`, `unavailableYpiStudioChildContextUsage`.
   - Privacy: ids + numbers + availability/source/capturedAt only.

3. **Rollup merge** (`lib/usage-stats.

### review.md

# REV-01 最终任务级评审

## Verdict

**CHANGES_REQUESTED** — 计划/HTML 原型审批、静态审查、数据契约、文档和自动验证均已通过；但真实应用浏览器验收仍因本 worktree 无法启动而没有证据。该项是最终验收 blocker，原型检查不能替代实际组件检查。

## Findings Fixed

- 当前 Studio session 已明确批准计划和 HTML 原型的视觉、互斥交互、移动策略与 unknown/unavailable 降级；已同步到 `plan-review.md`、`ui.md`、`checks.md`。未补造日期或外部审批证据。
- DOC-01 已完成：`docs/modules/frontend.md`、`docs/modules/api.md`、`docs/modules/library.md`、`docs/architecture/overview.md` 已覆盖 `SessionStatsChips` 与 additive `childSessions[].contextUsage` 的来源、availability、隐私、响应式和 reduced-motion 规则。

## Remaining Findings

### Blocker — 真实应用浏览器验收不可执行

- 30141 的监听进程 cwd 为 `/Volumes/01/ExternalStorage/Projects/gitProjects/pi-agnet-web`，不是当前 worktree，不能作为本改动的证据。
- 当前 worktree 的 `node_modules` 是指向上述目录的外部符号链接。尝试 `node_modules/.bin/next dev -p 30142` 后，Next/Turbopack 报错：`Symlink [project]/node_modules is invalid, it points out of the filesystem root`；页面请求返回 502。
- 因此尚未在实际组件上验证 hover、键盘、outside click、375/640px、明暗主题、reduced-motion，以及 parent/standalone/studio_child 三种场景。已有原型浏览器检查和静态阅读不替代这些证据。

## Passed Review Points

- **费用口径：** parent 使用 rollup，且仅真实 child usage 时显示 `incl. Studio`；standalone 使用自身；studio_child 使用 `selectedSessionTotals` 自身，并仅在浮窗附父级参考。聚焦回归覆盖三类口径。
- **上下文真实性：** child context 仅由 SDK child `AgentSession.getContextUsage()` 的 runtime snapshot 投影；无样本为 null-valued `unavailable`，不把 lifetime usage/progress token 当作 occupancy。
- **隐私与兼容：** child 投影仅有 id、member/subtask/status 和数值 snapshot/source/capturedAt；无 transcript、prompt、output、tool result、artifact 或路径。字段 additive，hook 的 AbortController/effective-session-id stale guard 和 local fallback 保持不变。
- **交互和响应式（静态）：** 两个互斥 button popover 使用 portal/fixed clamp、Escape、外部 pointerdown、hover/focus/click 和内部 child 滚动；`≤640px` 隐藏 token chips、保留费用/上下文；reduced-motion 禁用动画/transition。

## Verification

- `npm

### checks.md

# Checks：Session 指标 Chips 与上下文浮窗

## 门禁检查

- [x] `ui-designer` 已交付真实 HTML 原型，而非纯 Markdown。
- [x] 当前 Studio session 已明确批准原型、移动策略、动画强度和 child unavailable 降级。
- [x] `plan-review.md` 当前 revision 已获批准。
- [x] child context telemetry/API 的数据来源与隐私边界已在 Design 中落实。

## 需求覆盖

- [ ] input/output/cache/费用/上下文显示为统一紧凑 chips，顶栏高度未变化。
- [ ] parent、standalone、studio_child 三类 compact 费用口径与现有注释完全一致。
- [ ] 只有真实 child usage 才显示 `incl. Studio`。
- [ ] 费用与上下文分别触发独立浮窗，不会同时残留两个浮窗。
- [ ] 上下文浮窗第一项为当前 Session，随后为 Studio children。
- [ ] child 行显示 member/step/status 和 context；未知时明确 unavailable。
- [ ] lifetime usage 未被当成 context percent/tokens。
- [ ] 正常/关注/告警/未知四态均有非颜色信号。

## 交互与可访问性

- [ ] 鼠标 hover 打开，trigger 到浮窗移动不闪退。
- [ ] Tab/Shift+Tab 可到达 trigger；Enter/Space/click 可切换。
- [ ] Escape、外部点击、失焦按设计关闭；无焦点丢失。
- [ ] `aria-expanded` / `aria-controls` / label 与浮窗语义正确。
- [ ] 触屏没有 hover-only 死路。
- [ ] `prefers-reduced-motion: reduce` 下无非必要 pulse/shimmer。
- [ ] 200% 缩放下内容可用，无不可达浮层。

## 状态与响应式

- [ ] 无 stats、仅 usage、仅 context、context percent unknown 均正确。
- [ ] parent 无 children、有 children 但零 usage、有真实 child usage 均正确。
- [ ] 1、5、10+ children 列表可用，排序稳定，内部滚动不滚动页面。
- [ ] 长 member/subtask/id 截断且可获取完整信息。
- [ ] child snapshot loading/available/unavailable/stale（若设计支持）均诚实展示。
- [ ] 1440px、1024px、900px、640px、375px 无页面横向溢出。
- [ ] 浅色/深色主题对比度和告警层级清晰。

## 数据与回归

- [ ] Session 切换时旧响应不会覆盖新 Session（abort/race guard）。
- [ ] parent message list/SSE/model context 未混入 child 内容或 usage detail entries。
- [ ] API 不返回 prompt、output、tool result、artifact、本机路径。
- [ ] additive 字段缺失时旧 Session/旧响应正常降级。
- [ ] child audit Session 仍为 read-only，compact 只显示自身费用。
- [ ] ChatGPT usage panel、顶栏其他按钮、右侧面板切换无布局回归。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

如新增纯函数/数据投影，应补充并运行聚焦测试，至少覆盖：阈值分类、三类费用口径、child unavailable、稳定排序和 additive res

### design.md

# Design：Session 指标 Chips 与子 Session 上下文数据

## 方案摘要

将 `AppShell` 中内联的 Session stats 区块拆成小型展示组件（建议 `SessionStatsChips`），并把通用 hover/focus/click 浮层行为抽为可复用的 `TopbarMetricPopover`。费用与上下文成为独立 trigger。现有费用 totals 与口径保持原样；上下文浮窗复用 parent/selected Session 的 `contextUsage`，对 Studio children 增加可选、显式可用性的 context snapshot 投影。

## 影响模块与边界

| 模块 | 计划改动 | 边界 |
| --- | --- | --- |
| `components/AppShell.tsx` | 计算已确认的 compact 口径，渲染 chips，连接两个 popover | 不重做顶栏导航，不改 Session 生命周期 |
| 新建 `components/SessionStatsChips.tsx`（建议） | chips、费用浮窗、上下文浮窗、键盘/触屏行为 | 纯展示与轻交互；不自行扫描 Session |
| `hooks/useAgentSession.ts` | 透传 child summaries/context snapshots；维持 race/abort/refresh | local fallback 仍为 standalone |
| `lib/usage-stats.ts` / `/api/usage` | additive child context projection 或关联标识 | 旧字段语义不变，不返回内容体 |
| Studio child runtime（仅若采用准确遥测方案） | 提供 bounded context snapshot | 不把 transcript 注入父会话，不高频写 task.json |
| `app/globals.css` | scoped chips/popover/动画/响应式样式 | reduced-motion 必须静态降级 |
| 文档 | 更新 frontend；API 变化时更新 api/architecture | 不改 AGENTS 顶层索引，除非新增主要模块/路由 |

## 现有数据与缺口

### 已有

- 当前选中 Session context：`ChatWindow -> onContextUsageChange -> AppShell`，字段 `{ percent, contextWindow, tokens }`，来自 live `AgentSession.getContextUsage()`。
- Session usage rollup：`UsageSessionRollupResult` 已包含 `selectedSessionKind`、own/children/parent totals 和 `childSessions[]`。
- 费用 compact 口径已在 `AppShell`、`useAgentSession`、`usage-stats` 注释和文档中确认。

### 缺口

- `SessionUsageTopbarStats` 当前未透传 `childSessions[]`。
- `childSessions[]` 只有 lifetime usage、child metadata，不包含“当前上下文占用”。
- Studio child 的 progress `tokens/tps` 不是 context occupancy；不能用于百分比。
- completed/archived child 未必有活跃 AgentSession，必须允许 snapshot unavailable。

## 推荐数据契约

新增 additive 类型，名称可在实现时按现有类型体系调整：

```ts
type SessionContextUsageSnapshot = {
  percent: number | null;

### implement.md

# Implement：Session 指标 Chips 与上下文浮窗

## 需先阅读

- `AGENTS.md`
- `docs/modules/frontend.md`
- `docs/modules/api.md`
- `docs/architecture/overview.md` 的 Usage accounting / Studio child boundaries
- `docs/standards/code-style.md`
- `components/AppShell.tsx` 顶栏 stats 与 `BillingPopover`
- `components/ChatWindow.tsx` 的 stats/context 上抛
- `components/ChatGptUsagePanel.tsx`
- `hooks/useAgentSession.ts` 的 `SessionUsageTopbarStats` 与 rollup fetch
- `lib/usage-stats.ts` 的 `UsageSessionRollupResult`
- 本任务获批的 `prd.md`、`ui.md`、HTML 原型、`design.md`、`checks.md`

## 人类可读子任务表

| ID | Phase | Order | 子任务 | 依赖 | 主要文件 | 可并行 |
| --- | --- | ---: | --- | --- | --- | --- |
| UI-01 | UI | 1 | UI 设计员生成 HTML 原型并取得用户审批 | 无 | task `ui.md`, `session-stats-chips-prototype.html` | 否 |
| SPIKE-01 | Design | 2 | 验证 child `getContextUsage()` 的准确投影与依赖方向 | UI-01 | Studio child runtime、`rpc-manager`、`usage-stats` | 否 |
| DATA-01 | Implement | 3 | 实现最小 additive child context 数据契约与降级 | SPIKE-01 | hook、usage/API，必要时 runtime | 否 |
| UI-02 | Implement | 4 | 按原型实现 chips、独立浮窗、阈值与响应式 | DATA-01 | `AppShell`, 新组件, globals CSS | 否 |
| DOC-01 | Docs | 5 | 更新 frontend/API/architecture 文档 | DATA-01, UI-02 | `docs/modules/*`, architecture | 可与聚焦测试准备并行 |
| CHK-01 | Checks | 6 | 静态、交互、响应式、隐私与口径检查 | UI-02, DOC-01 | checks + diff | 否 |
| REV-01 | Review | 7 | 独立检查员对照原型与契约评审 | CHK-01 | 全部改动 | 否 |

## 实现步骤

1. **先满足 UI 门禁。** `ui-designer` 交付自包含 HTML，用户确认 chip 密度、浮窗层级、移动策略和动画；未批准不得写生产代码。
2. **做数据 spike。** 在不改产品语义的前提下确认 Studio SDK child 是否可从 AgentSession 获取权威 `getContextUsage()`，以及活跃/终止 child 的 snapshot 是否已有安全承载位置。结论必须记录：来源、刷新频率、终止后行为、隐私字段、不可用降级。
3. **只选一条最小数据路径。** 优先 additive 扩展 session rollup；若 usage→Studio runtime 依赖不合理，再使用单独只读 context endpoint。禁止双实现，也禁止累计 usage 推算。
4. **透传数据。** 扩展 `SessionUsageTopbarStats` 的 child summaries，保持 A

## Source artifacts
- handoff.md
- review.md
- checks.md
- design.md
- implement.md
- prd.md
- brief.md
- ui.md
- plan-review.md
