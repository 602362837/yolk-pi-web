# SVG 图标线条流动 Action Tag / 全局圆角计划审批书（修订版）

## 审批结论请求

用户已明确反馈：

> 1 和 2 流动的效果我希望是在按钮的图标上（看上去是矢量图）在有内容的线条做颜色流动；3 和 4 没问题。

计划和 HTML 原型已据此修订。原“按钮边框沿边微光”方案正式作废；新方案保留 pill action tag 和静态边框，但把动态效果改为 **inline SVG 图标可见 stroke/path 线条上的局部渐变亮色流动**。

UI 设计员已重新交付可交互原型：[tech-action-tags-prototype.html](tech-action-tags-prototype.html)。请再次审阅修订后的决策 1、2；**再次明确批准后才可进入实现，当前不得修改生产代码。**

## 四项决策状态

| # | 决策 | 状态 |
| --- | --- | --- |
| 1 | 图标保留 base stroke，叠加同几何 gradient overlay stroke；局部亮色段通过 dash offset 沿可见线条行进。按钮边框/背景不持续流动。 | **已按反馈修订，待再次批准** |
| 2 | 侧栏可用图标默认低频错峰流动；顶栏图标默认静态，仅 hover/focus/active 流动；disabled/reduced-motion 完全静态。 | **已按反馈修订，待再次批准** |
| 3 | 260px 单行四列；220px 2×2，保留完整图标与文案。 | **用户已批准，保持不变** |
| 4 | 普通按钮 8px 圆角基线；action tag pill；圆形/分段/特殊控件保留例外；不用破坏性的全局 `!important`。 | **用户已批准，保持不变** |

## 方案摘要

### PRD

- 左下角四按钮与 Chat 顶栏动作统一为独立 pill action tag。
- 科技感只落在图标矢量线条：base stroke 上叠加沿线条移动的渐变亮色段。
- active/open 由静态边框、表面、文字和图标共同表达；disabled 无 hover/动画。
- 功能、顺序、面板、API、配置和 session 数据均不改变。

### UI

- 修订原型已移除按钮边框流动，直接展示 SVG line/path 的颜色行进。
- 侧栏默认低频错峰；顶栏仅交互/active 时启动；reduced-motion 完全静态。
- Desktop tag 约 28–30px 高；移动端隐藏文案，保留 28×28 图标 tag。
- 已批准布局保持：260px 单行；220px 2×2。

### Design

- 目标图标已确认均为 inline stroke SVG，不是字体图标或外部图片。
- 推荐共享 `ActionFlowIcon`：同一几何渲染 `currentColor` base 与 gradient dashed overlay，per-instance gradient id 防冲突。
- CSS 只动画 overlay 的 `stroke-dashoffset`；不动画按钮伪元素、边框或背景，不引入动画库/计时器。
- overlay 异常时 base stroke 仍可读；disabled/reduced-motion 隐藏 overlay。

### Implement

1. 建立 radius/action-tag CSS 与共享 SVG icon-flow primitive。
2. 接入侧栏底部和 AppShell 顶栏，保持事件、badge、aria、顺序和面板逻辑。
3. 对齐 Branches trigger、移动端、reduced-motion 和 Safari/Chromium fallback。
4. 更新前端文档并记录真实验证证据。
5. 独立检查原型一致性和全局圆角回归。

### Checks

- 自动：`npm run lint`、`node_modules/.bin/tsc --noEmit`。
- 重点人工检查：图标亮色段是否只沿 stroke/path 行进；按钮边框/背景是否静态；侧栏/顶栏时机；disabled/reduced-motion；gradient fallback。
- 回归：浅/深主题、260/220px、640/390/320px、active/badge、Branches dropdown、键盘、全局圆角特殊形状。

## 相关材料

- [Brief](brief.md)
- [PRD](prd.md)
- [UI 设计说明](ui.md)
- [修订 HTML 交互原型](tech-action-tags-prototype.html)
- [Technical Design](design.md)
- [Implementation Plan](implement.md)
- [Checks](checks.md)

## 再次审批请求

请重点查看原型中的图标线条亮度、速度和触发时机。推荐回复：

**“批准修订原型与计划：1 图标线条流动，2 侧栏低频错峰、顶栏仅交互/active；3、4维持已确认，开始实现。”**

如需调整，请指出决策 1 或 2。未收到再次明确批准前，任务保持 `awaiting_approval`，禁止进入 `implementing`。
