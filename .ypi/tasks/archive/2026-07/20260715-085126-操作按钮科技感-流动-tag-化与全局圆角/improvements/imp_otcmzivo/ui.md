# UI — IMP-001 最大合理替换（修订）

## UI Summary

用户可见变化从「几乎只有顶栏/侧栏」扩大为 **多区域工具条与独立 action 的图标线条 hover 流动**，同时：

- 列表行、危险、关闭、spin 刷新等 **保持静止**；
- 按钮边框/背景仍静态；
- 不强制所有按钮改成 pill tag（chrome 可保留原样）。

## 是否需要 HTML 原型？

**是 — 必须更新/重做。**

原因：可见范围显著扩大，原「opt-in 矩阵 + 单点 Browser Share」不足以表达「多区域白名单 vs 黑名单」。  
新原型：[`icon-flow-opt-in-prototype.html`](icon-flow-opt-in-prototype.html)（修订为多区域示范）。

## 原型应展示

1. **契约提醒**：无 `data-icon-flow` = 静止；禁止全局扫射文案。
2. **区域示范（替换后）**
   - 顶栏 / 侧栏 utility（已有语言）
   - Chat 底栏：Attach / Browser Share / Send / Compact / toggles
   - 侧栏工作区工具：新建 / 工作树 / 刷新 / 更多
   - 面板工具条：Refresh / Add skill 风格
3. **黑名单示范（必须静止）**
   - Delete / Close / 会话行操作 / Stop 实心
4. 主题切换 + reduced-motion 开关。

## Visual / Interaction（相对主任务）

| 项 | 规格 |
| --- | --- |
| 流动载体 | 仅 SVG stroke overlay dash |
| 新入口模式 | 默认 interactive；侧栏四 utility 仍 ambient |
| 速度 | interactive ~1.5–1.6s；ambient ~4.8s 错峰（与主任务一致） |
| 边框 | 静态 |
| 密度 | 工具条可流动；行内密集操作禁止 |
| chrome | 不强制 `.tech-action-tag`；可只加 attr |

## UI Checks

- [ ] 原型多区域白名单在 hover/focus 下线条流动。
- [ ] 黑名单卡片/行无流动。
- [ ] 无 attr 示例静止。
- [ ] reduced-motion 关闭全部流动。
- [ ] 深浅主题可辨。

## Review Request

请用户确认：

1. 「能换都换」= 白名单最大替换，而不是无脑全 button。
2. 黑名单（危险/行内/关闭/spin）可接受。
3. 不强制统一 pill chrome。
