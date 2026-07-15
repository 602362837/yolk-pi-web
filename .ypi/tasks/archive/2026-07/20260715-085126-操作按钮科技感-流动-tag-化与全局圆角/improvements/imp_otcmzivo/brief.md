# Brief — IMP-001（修订：最大合理全站替换）

## 用户反馈（原话）

> 其实是希望范围尽量大，然后能替换的都替换

此前推荐的「能力-only + 0 示范接入 / 最多 1 个 Browser Share」**正式作废**。

## 主任务现状（证据）

- 已实现 `components/ActionFlowIcon.tsx`：base `currentColor` + per-instance gradient dashed overlay；`useId()` 清洗为 SVG URL 安全 id。
- 动效 CSS 在 `app/globals.css`，当前选择器仍强耦合 `.tech-action-tag[data-icon-flow=…]` 与侧栏 ambient 错峰。
- 已接入：`AppShell` 侧栏四入口 + Chat 顶栏动作 + `BranchNavigator` inline trigger（约 12 个宿主）。
- 主任务检查 `pass_with_notes`：结构正确；live UAT 仍是验收残留，与本改进正交。

## 问题

1. 能力未解耦：非 `.tech-action-tag` 宿主无法复用 interactive 流动。
2. 接入面过窄：全仓大量独立 stroke 图标 action 仍是裸 SVG + 内联 hover。
3. 用户明确要求 **范围尽量大、能换都换**，但仍禁止无脑 `button { animation… }` 扫射。

## 改进目标

在保持 **opt-in 契约**（宿主 `data-icon-flow` + `ActionFlowIcon`）与 **黑名单安全边界** 的前提下，做 **最大合理替换**：

1. CSS 解耦为宿主无关的 `data-icon-flow` motion。
2. 薄 helper（`iconFlowAttrs`）+ 文档化白/黑名单。
3. 扫描 `components/` 后，凡「独立 action 图标按钮 / 工具条 action / 可点击 icon+label 操作」且几何可迁到 stroke `ActionFlowIcon` 的，**尽量全部替换为 interactive**（侧栏 utility 保留 ambient）。
4. 更新多区域 HTML 原型，展示替换前黑白名单与示范。

## 非目标

- 不是全局 CSS 自动让所有 `button` 动画。
- 不恢复边框/背景扫光。
- 不强制 pill 化所有按钮 chrome（可只换图标 + `data-icon-flow`，不必都变成 `.tech-action-tag`）。
- 黑名单仍不替换：危险 destructive、密集列表/树/表行内小按钮、关闭 X、分段内部、统计 chip 主体、已有 spin 的刷新、不可控外部图标、非 stroke 实心装饰。
- 不改 API、session、SSE、配置或业务事件。

## 规模（规划扫描结论，实现前再 diff 复核）

| 桶 | 约计数 | 说明 |
| --- | --- | --- |
| 已接入（契约迁移） | ~12 | AppShell 顶栏/侧栏 + Branches |
| **本改进应替换（白名单）** | **~35–45** | 见 PRD 清单；分批接入 |
| 明确黑名单 / 跳过 | 大量 | 行内 Delete/Archive、Close、Stop fill、Git spin refresh、树/表行等 |
| 边界 / 可选 | 少量 | Terminal 非危险工具条、主题 pressed 持续 flow polish |

## 推荐决策草案（待审批）

1. **能力**：`ActionFlowIcon` + 宿主无关 `data-icon-flow`；默认关闭；禁止全局 button 强制动画。
2. **深度**：**最大合理全站替换**（白名单尽量换），不是 0 示范。
3. **模式**：新入口默认 `interactive`；`ambient` 仍仅侧栏 utility 白名单容器。
4. **黑名单**硬门禁，检查员按清单否决误接入。

## 门禁

- 修订计划须用户再次明确批准后才能实现。
- 范围变大 → **必须**更新 HTML 原型与 `plan-review.md`。
- 本改进师 **不修改生产代码**。
