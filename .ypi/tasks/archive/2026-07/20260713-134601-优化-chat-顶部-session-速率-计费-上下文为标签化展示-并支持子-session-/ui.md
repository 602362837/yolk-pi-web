# UI：Session 指标 Chips 与上下文浮窗

## 门禁状态

本任务改变现有页面展示、交互与信息结构，已触发 UI HTML 原型硬门禁。自包含交互原型现已交付：

- [打开 Session stats chips HTML 原型](session-stats-chips-prototype.html)

原型已交付，且**当前 Studio session 已明确批准**视觉、交互、移动策略和 unknown/unavailable 降级。

## 原型覆盖

- 顶栏 `↑ input`、`↓ output`、`cache`、`$ 费用`、`上下文 %` 五类 23px pill chips。
- 费用与上下文两个独立、互斥 popover；支持 hover、focus、click、外部点击和 Escape。
- Parent 场景首显本体，再列 12 个 Studio children，覆盖正常、关注、告警、未知、长名称与内滚动。
- Standalone 与 studio_child 场景切换；费用 compact 口径分别展示。
- 浅色/深色切换；1440px、900px、640px 模拟宽度。
- 640px 策略：隐藏 input/output/cache，保留费用与上下文，浮窗在 viewport 内左右收口。
- 轻量、有限次数的边框提示与数据更新动画；提供 reduced-motion 开关，并响应系统 `prefers-reduced-motion`。
- CSS 变量承载主题、状态色、边框、背景和阴影。

## 设计决策

1. **密度：** chip 高度固定 23px，保持现有 44px 顶栏高度；数字采用 tabular/mono 风格。
2. **入口分离：** 只有费用 chip 打开计费组成，只有上下文 chip 打开上下文占用；同一时刻最多打开一个。
3. **信息层级：** 上下文浮窗先显示当前 Session 摘要卡，再显示 children 风险优先列表；10+ children 使用内部滚动。
4. **状态阈值：** `<70%` 正常、`70–89%` 关注、`≥90%` 告警、不可得为未知。百分比与状态文案同时存在，颜色不是唯一信号。
5. **未知降级：** 不把 lifetime usage 当作 context occupancy；权威 snapshot 不可得时显示“暂无上下文数据”，lifetime token 只能作为明确标注的次要信息。
6. **费用口径：** parent compact 显示 rollup 并标记 `incl. Studio`；standalone 仅自身；studio_child compact 仅 child own，浮窗可附 parent rollup。
7. **响应式：** 900px 收紧间距并隐藏次要 compact mark；`≤640px` 隐藏 token chips、保留费用+上下文关键入口。
8. **动效：** 更新使用短暂淡入/边框提示，关注和告警仅有限次数轻提示；reduced-motion 下静态表达。
9. **可访问性：** trigger 使用 button、`aria-expanded`、`aria-controls` 与 dialog 语义；键盘和触屏不依赖 hover。

## 已获批准的决策

当前 Studio session 已明确批准以下决策：

1. 是否批准 23px chip 密度、状态颜色和轻动画强度？
2. 是否批准 context popover 的“当前 Session → 风险优先 children”信息层级？
3. 是否批准 `≤640px` 隐藏 token chips、保留“费用 + 上下文”的移动策略？
4. 是否批准 unknown 文案“暂无上下文数据”，以及 lifetime usage 只能作为明确标注的次要信息？
5. 是否批准费用与上下文 popover 的 hover/focus/click 互斥交互？

UI 门禁已满足；child context 数据 spike 与生产实现已按 Design 完成。最终仍需在可启动本 worktree 的环境完成真实应用浏览器验收。
