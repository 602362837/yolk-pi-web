# Chat 顶部 Session 指标优化计划审批书

## 审批结论

计划将 Chat 顶部 input/output/cache/费用/上下文改为紧凑 chips，并把费用组成与上下文占用拆为两个独立浮窗。上下文浮窗首先显示当前 Session，再显示 Studio children；颜色、状态文案和轻动画共同表达压力，并支持键盘、触屏、窄屏和 reduced-motion。

**当前 Studio session 已明确批准本计划及 HTML 原型的视觉、交互、移动策略与 unknown/unavailable 降级。**

- [审阅可交互 HTML 原型](session-stats-chips-prototype.html)
- [UI 设计决策与审批问题](ui.md)

此外，child 当前 context occupancy 仍缺少现成权威数据源；计划要求实现前先做聚焦 spike，批准最小 snapshot/只读数据路径，无法取得时必须显示 unavailable，禁止用 lifetime usage 推算。

## PRD 摘要

- 统一标签化 input/output/cache/费用/上下文，顶栏高度不变。
- 费用口径完全保留：parent rollup、standalone own、studio_child selected own。
- 上下文浮窗区分当前 Session 与 Studio children；未知数据不显示为 0%。
- 正常 `<70%`、关注 `70–89%`、告警 `≥90%`。
- 多 child 内滚动，颜色非唯一信号，动画遵守 reduced-motion。

详见 [PRD](prd.md)。

## UI 摘要

- 自包含 [session-stats-chips-prototype.html](session-stats-chips-prototype.html) 已交付。
- 原型覆盖 parent/standalone/studio_child、12 个混合状态 children、费用/上下文独立互斥浮窗、长名称、内滚动、明暗主题和 reduced-motion。
- 可切换 1440/900/640px；原型建议 `≤640px` 隐藏 input/output/cache，保留费用与上下文。
- chip 高度 23px；上下文以百分比、状态文字、颜色和进度共同表达。
- 当前 Studio session 已批准视觉、移动策略、unknown 降级与互斥交互。

详见 [UI](ui.md)。

## Design 摘要

- 建议提取 `SessionStatsChips` 与通用 topbar metric popover，避免继续堆叠 `AppShell` 内联 JSX。
- 当前 Session 复用 `contextUsage`；rollup 透传 child summaries。
- child lifetime usage/tps 不是 context occupancy。优先从 child AgentSession 的权威 `getContextUsage()` 产生 bounded snapshot；不可得时显式 unavailable。
- 数据契约全部 additive，不改 JSONL header、不迁移历史数据、不返回 child 内容。
- 优先 additive 扩展现有 session rollup；若依赖方向过深，再选独立轻量 context endpoint，禁止双路径。

详见 [Technical Design](design.md)。

## Implement 摘要

1. 用户审阅并批准已交付 HTML 原型。
2. 聚焦 spike 验证 child context snapshot 的权威来源与终止后行为。
3. 实现一条最小 additive 数据路径和 unavailable 降级。
4. 按获批原型实现 chips、两个互斥浮窗、响应式/动效/可访问性。
5. 更新文档，执行 lint/typecheck 与真实浏览器验收。
6. checker 独立评审后再进入用户验收。

机器可读 Implementation Plan 已包含在 [Implement](implement.md)，并已按获批计划完成执行。

## Checks 摘要

- HTML 已交付，当前 Studio session 的明确批准已记录；审批门禁已解除。
- 检查三类费用口径、child 数据真实性、Session 切换 race、隐私边界。
- 覆盖 hover/focus/click/Escape、触屏、200% zoom、reduced-motion。
- 覆盖无数据、unknown、10+ children、长名称、浅深主题和多个断点。
- 自动命令：`npm run lint`、`node_modules/.bin/tsc --noEmit`。

详见 [Checks](checks.md)。

## 已确认决策

- 批准 23px pills、状态配色和有限次数轻动画。
- 批准 context popover 的“当前 Session → 风险优先 children”信息层级。
- 批准 `≤640px` 隐藏 token chips、保留“费用 + 上下文”。
- 批准“暂无上下文数据”降级；lifetime usage 只能作为明确标注的次要信息。
- 批准最小权威 snapshot + unavailable 降级；不可安全取得的 child 行显示 unavailable。
- 确认维持只显示 cache-read，不增加 cache-write。

## 当前状态

- Brief / PRD / Design / Implement / Checks：已完成并进入最终检查。
- HTML 原型：已交付且已获当前 Studio session 批准。
- Implementation Plan：7/7 完成。
- 剩余门禁：须在可启动本改动 worktree 的环境完成真实应用浏览器验收；详见 [Checks](checks.md) 与 [Review](review.md)。
