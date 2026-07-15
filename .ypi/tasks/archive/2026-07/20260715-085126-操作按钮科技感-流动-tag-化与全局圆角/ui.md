# UI 规划：SVG 图标线条流动 Action Tag 与全局圆角

## UI Summary

### 设计目标

- 不改变入口顺序、业务行为、顶栏 36px 高度和面板锚点，把侧栏底部与 Chat 顶部操作统一为独立、圆角、可辨识的 action tag。
- 按用户反馈，科技感由 **inline SVG 图标可见线条内的颜色流动**表达；按钮边框保持静态，不再采用沿边微光。
- “全局圆角”采用普通按钮基线 + 语义形状例外，不强制所有按钮为 pill。

### 现有体验对齐

- 颜色复用 `--bg* / --border / --text* / --accent*`，另以主题变量派生 cyan/blue/violet 的图标流动色。
- App top bar 保持 36px、移动端横向滚动及 `.app-top-label` 隐藏契约。
- 保留 Models / Usage / Skills / Settings 与 Export / Branches / System / Subagents / Git / Terminal 的顺序、图标语义、文案和功能。
- Session stats chips 与 ChatGPT quota panel 不重画；action tag 通过 28px 高度、静态细边框和低对比表面与统计 chip 协调。

### 主要路径

1. 用户在 Chat 顶栏识别独立 action tag。
2. 顶栏默认图标静态；hover / focus / active 时，局部渐变亮色段沿图标 stroke/path 行进。
3. active/open 同时用背景、静态边框、文字和图标表达；Subagents/Git badge 始终位于更高层级。
4. 侧栏可用图标以更低频率错峰流动；Skills 禁用时图标和按钮完全静态。

## HTML Prototype

UI 设计员已按反馈重新交付自包含交互原型：[`tech-action-tags-prototype.html`](./tech-action-tags-prototype.html)

原型控制项：

- 主题：浅色 / 深色 / 双主题；
- 视图：Desktop / Mobile；
- 侧栏：260px / 220px；
- 动效：图标线条流动 / 静态模拟；
- 点击可用 tag 模拟 active/open；
- 状态板覆盖 default、hover、active、disabled、focus-visible 与 badge。

## Visual Specification

### Action tag

- 顶栏高 28px；侧栏高 30px。
- action tag 使用 `999px` pill；普通按钮基线 8px；紧凑普通按钮可用 6px。
- 边框始终是静态 1px `--border` 回退；hover/active 仅改变静态颜色和表面，不执行边框动画。
- 桌面文字 tag 内间距约 `0 9px`；图标 tag 28×28；移动端顶栏均收为 28×28 并隐藏文案。
- 图标沿用现有 12–16px 线性 SVG，不改图标语义。

### SVG 图标线条流动

- 每个图标保留一层低对比 base stroke (`currentColor`)。
- 在同一 SVG 内叠加同几何的 decorative overlay stroke；overlay 使用 cyan → blue → violet 的渐变 stroke。
- overlay 通过 `stroke-dasharray` 形成局部亮色段，通过 `stroke-dashoffset` 让亮色段沿已有 path/line/rect/circle 线条行进。
- 不是按钮外框动画、背景扫光、整块图标统一闪烁，也不改变图标几何或尺寸。
- 侧栏默认约 4.8–7.2s 低频错峰；顶栏 hover/focus 约 1.5–3.2s，active 可略快。最终速度以用户审批后的原型观感为准。
- overlay 为纯视觉层：`aria-hidden` / 不进入可访问名称，且不接收 pointer event。
- disabled、原型静态模式和 `prefers-reduced-motion: reduce` 下 `animation:none`；生产实现建议完全隐藏动态 overlay，保留 base stroke。

### 220px 侧栏（已批准）

- 260px：四项单行四列。
- 220px：2×2 网格，保留全部图标与文案。
- 仅改变侧栏底部操作容器，不改变侧栏最小宽度或主体列表。

## Interaction States

| 场景 | tag 表面 | 图标线条 | 用户反馈 |
| --- | --- | --- | --- |
| Default 顶栏 | 静态细边框、低对比表面 | base stroke，overlay 静止/隐藏 | 可点击但不制造持续噪声 |
| Default 侧栏 | 同上 | 可用项低频错峰亮色段 | ambient 科技感集中在图标 |
| Hover | 静态边框/文字增强 | overlay 沿线条流动 | 无布局位移 |
| Focus-visible | 2px accent outline | overlay 沿线条流动 | Tab 焦点稳定可见 |
| Active/Open | accent 混合静态边框、浅表面 | overlay 增强，可持续流动 | 不依赖顶部色条 |
| Disabled | dim 表面/文字 | 仅静态 base stroke，无 overlay 动画 | 不暗示可点击 |
| Badge | 表面不变 | 图标动效不进入角标区域 | running/completed/dirty 独立可辨 |
| Reduced motion | 状态表面保留 | 仅静态 base stroke | 无持续流动或闪烁 |

## Responsive

### Desktop（>640px）

- 顶栏增加 3–4px tag 间距和少量内边距，tag 垂直居中于 36px；不再占满整高或依赖右分隔线。
- Branches trigger 外层保持锚点语义，按钮本体 tag 化。

### Mobile（≤640px）

- `.app-top-label` 继续隐藏，顶栏 tag 固定 28×28，顶栏保持横向滚动。
- 每个图标保留准确 `aria-label` 与 `title`。
- 图标线条流动范围不得超出 SVG viewBox 或被滚动容器裁切；badge 向内收 1–2px。
- 侧栏 overlay 继续使用宽屏布局逻辑；220px 是桌面最窄持久化宽度验证。

## Accessibility

- 原生 `button` 语义不变；开关型按钮同步 `aria-expanded` / `aria-pressed`，disabled 使用原生属性。
- decorative overlay 不可替代可访问名称；SVG 图标继续 `aria-hidden`，按钮由 label/title 命名。
- `focus-visible` 不依赖动画或颜色单一线索。
- reduced-motion 下完全移除持续 dash 动画；状态仍由表面、边框、文字和属性表达。
- 最小图标点击目标 28×28。

## Implementation Notes

### 推荐 token

```css
:root {
  --control-radius: 8px;
  --control-radius-sm: 6px;
  --control-radius-pill: 999px;
  --control-motion-fast: 140ms;
  --icon-flow-ambient: 4.8s;
  --icon-flow-interactive: 1.55s;
}
```

### 推荐复用契约

- `.tech-action-tag`：共享静态结构、表面、focus、disabled。
- `.tech-action-tag--icon`：图标方形 tag。
- `.action-flow-icon__base` / `.action-flow-icon__overlay`：base + duplicate overlay stroke。
- `.sidebar-utility-tag`：30px 和 ambient 策略。
- `.app-top-action-tag`：28px 和仅交互态策略。
- `[data-icon-flow="ambient|interactive|off"]`：只控制 SVG overlay 运动。
- `[aria-expanded="true"] / [aria-pressed="true"] / .is-active`：统一 active 视觉。

### 实现边界

- 当前目标图标均为 inline stroke SVG，不需要字体图标、图片替换或 CSS mask 重绘。
- 推荐共享 `ActionFlowIcon` 用 per-instance gradient id 渲染 base/overlay 两组同几何，避免文档级 SVG id 冲突；若渐变不可用，base stroke 仍完整可读。
- 不使用 `button { border-radius: ... !important }`。
- 删除目标按钮内联 mouse enter/leave 改色，避免 class 与 DOM style 冲突；业务事件、顺序、ref、dropdown 和 badge 逻辑不变。
- overlay 动画不得作用于按钮伪元素；badge 层级高于 SVG，不被裁切。

## UI Checks

- [ ] 浅/深主题中可看见亮色段只沿图标线条行进。
- [ ] 按钮外框和背景没有持续流动。
- [ ] 侧栏可用图标低频错峰；顶栏默认静态、仅交互/active 流动。
- [ ] disabled 和 reduced-motion 完全无持续图标动画。
- [ ] 260px 单行、220px 2×2；移动端 28×28 图标 tag 可横向滚动。
- [ ] active/open、focus、badge、Branches dropdown 和统计区无回归。
- [ ] gradient/dash 异常时 base stroke 仍可读且可点击。

## Review Request

决策 3、4 已获用户确认。请用户审阅修订后的 HTML 原型，并再次明确确认：

1. 图标可见线条内的渐变亮色段及其亮度/速度；
2. 侧栏默认低频错峰、顶栏仅 hover/focus/active 流动的时机策略。

上述两项再次批准前，不应修改生产代码或进入 implementing。
