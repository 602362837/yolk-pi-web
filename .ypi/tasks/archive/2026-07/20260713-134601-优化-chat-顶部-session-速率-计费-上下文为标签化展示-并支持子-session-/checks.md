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

如新增纯函数/数据投影，应补充并运行聚焦测试，至少覆盖：阈值分类、三类费用口径、child unavailable、稳定排序和 additive response compatibility。常规开发不直接运行 `next build`。

## 人工验收证据

实现员/检查员应记录：

- 获批 HTML 原型与实际 UI 对照截图（明暗主题各一）。
- parent + 3 children（正常/告警/未知）浮窗截图。
- studio_child compact + parent rollup 费用浮窗截图。
- 375px 或获批移动策略截图。
- 键盘操作和 reduced-motion 检查结果。

## 重点阻塞判定

以下任一项为 blocker：无 HTML 原型/审批；费用口径变化；用 lifetime usage 冒充 context；浮窗键盘不可达；移动端页面溢出；child 内容泄漏；reduced-motion 仍持续动画。

## CHK-01 验收记录（2026-07-13）

### 自动验证

- [x] `npm run lint` — 通过。
- [x] `node_modules/.bin/tsc --noEmit` — 通过。
- [x] `node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-usage-stats-rollup.mjs` — 通过；覆盖 parent / standalone / studio_child 费用口径、`contextUsage` unavailable/live/lastKnown/null-occupancy，以及 context 投影不改变 billing totals。
- [x] `git diff --check` — 通过。

### 静态验收

- [x] `SessionStatsChips` 仅将 runtime snapshot 投影为 child context；unavailable 值为 `null`，UI 显示“暂无上下文数据”；lifetime tokens 仅带 `lifetime` 标签。
- [x] parent compact 使用 rollup、只在真实 child usage 时标记 `incl. Studio`；standalone 使用 own；studio_child 使用 `selectedSessionTotals`，billing 中仅作父 rollup 参考。
- [x] children 按 danger/watch/normal/unknown 风险排序，列表 `max-height: 242px` 且内部滚动；长名称保留 `title`。
- [x] billing/context 使用独立 button、portal/fixed popover、互斥 `openPopover` 状态、Escape、外部 pointerdown、focus/hover 和 reduced-motion CSS。
- [x] 修复检查中发现的 trigger 切换 race：已安排的前一浮窗关闭现在只会关闭自身，不会在鼠标切至另一 trigger 后错误关闭新浮窗；dialog 也获得可读 `aria-label`。
- [x] `≤640px` 隐藏 token chips，保留费用和上下文；浮窗为 fixed 并做 viewport clamp。
- [x] runtime/API 投影只含 session id、member/subtask/status、数值 snapshot/source/capturedAt；未发现 transcript、prompt、output、tool result、artifact 或本机路径字段。

### 原型浏览器证据

- [x] 使用 `agent-browser` 打开获批 `session-stats-chips-prototype.html`：Parent context 浮窗首显当前 Session，随后 12 个风险优先 children；unknown 明示且 lifetime usage 未作为 occupancy。
- [x] 点击费用后点击上下文，原型仅保留后一浮窗；Escape 关闭。截图：`/tmp/ypi-prototype-context.png`。
- [x] 原型切至 640px：仅费用、上下文 chips 可见。截图：`/tmp/ypi-prototype-640.png`。
- [x] 原型深色 + Reduced motion 控制可用。截图：`/tmp/ypi-prototype-dark-reduced.png`。

### 最终复查（当前 checking 阶段）

- [x] 当前 Studio session 已明确批准计划和 HTML 原型；批准范围已同步到 `plan-review.md`，未补造日期或外部证据。
- [x] DOC-01 已完成：`docs/modules/frontend.md`、`docs/modules/api.md`、`docs/modules/library.md`、`docs/architecture/overview.md` 已记录 `SessionStatsChips` 与 additive child `contextUsage` 契约。
- [x] 再次运行 `npm run lint`、`node_modules/.bin/tsc --noEmit`、聚焦 usage-rollup 脚本和 `git diff --check`，均通过。
- [x] 使用 `agent-browser` 复查本地 HTML 原型：费用/上下文入口、Escape、640px 策略和 reduced-motion 控制可执行；截图：`/tmp/ypi-prototype-final-check.png`。此项仅为原型补充检查。
- [ ] **真实应用浏览器验收仍受环境阻塞：** 30141 的监听进程 cwd 是 `/Volumes/01/ExternalStorage/Projects/gitProjects/pi-agnet-web`（不是本 worktree）；本 worktree 的 `node_modules` 是指向该目录的外部符号链接。尝试 `node_modules/.bin/next dev -p 30142` 后 Turbopack 报 `Symlink [project]/node_modules is invalid, it points out of the filesystem root`，请求返回 502。故未能验证实际组件的 click/hover/keyboard/outside click、375/640px、明暗主题、reduced-motion 及三类 Session 场景；原型和静态审查不替代该项。
