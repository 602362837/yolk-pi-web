# Brief

## 原始需求

1. 左下角四个操作按钮的样式修改下，要有科技感，尤其是需要加流动效果，然后这种按钮最好可以像 tag 一样。
2. Chat 区域顶部的那些操作要求同 1，而且按钮希望全局圆角化。

## 用户修订反馈

> 1 和 2 流动的效果我希望是在按钮的图标上（看上去是矢量图）在有内容的线条做颜色流动；3 和 4 没问题。

据此，原方案中的按钮边框沿边微光已作废。流动必须落在按钮的矢量图标可见 stroke/path 线条上；tag 外框保持静态，只承担边界和 active/open 状态表达。

用户已确认：

- 260px 侧栏单行四列，220px 采用 2×2，保留完整图标与文案。
- 普通按钮 8px 圆角基线，action tag 使用 pill；圆形、分段和特殊控件保留例外，不使用破坏性的全局 `!important`。

## 现状证据

- 左下角四按钮位于 `components/AppShell.tsx` 的 `sidebarContent` 尾部，实际为 Models / Usage / Skills / Settings；目标图标均为 inline SVG，使用 `fill="none"`、`stroke="currentColor"` 及 `path/line/rect/circle` 几何。
- Chat 顶部操作同样集中在 `components/AppShell.tsx`；Branches inline trigger 位于 `components/BranchNavigator.tsx`。目标图标也都是 inline stroke SVG，不是字体图标或外部图片，适合在保留基础描边的同时叠加同几何的动态 stroke。
- 当前按钮视觉主要由内联样式和 DOM hover 改色控制；多数顶栏按钮占满 36px 高度，并以分隔线和顶部 2px active 边表达状态。
- `app/globals.css` 已有主题变量、`prefers-reduced-motion` 和移动 top bar 横向滚动规则，但尚无统一 control radius / icon-flow token。
- 全仓存在大量显式 `borderRadius`；直接使用 `button { border-radius: ... !important }` 会破坏圆形、分段和特殊控件。

## 目标

形成统一的“圆角 action tag + 图标线条颜色流动”视觉语言：左下角四按钮与 Chat 顶部操作保持独立 tag 形态，科技感由 inline SVG 可见线条上的移动亮色段表达；同时建立普通按钮圆角基线，并覆盖主题、移动端、禁用态、键盘焦点和减少动态偏好。

## 推荐决策

1. 图标保留低对比 base stroke，再叠加同几何的 gradient overlay stroke；通过 `stroke-dasharray` / `stroke-dashoffset` 让局部亮色段沿图标线条行进。按钮边框不做持续动画。
2. 侧栏可用图标默认低频错峰流动；顶栏图标默认静态，仅 hover、focus-visible、active/open 时流动；disabled 和 reduced-motion 完全静态。
3. tag 高约 28–30px、pill 圆角、静态细边框；移动端继续隐藏文案并保留图标 tag。
4. “全局圆角”采用普通按钮 8px 基线 + 语义形状例外，不强制所有按钮成为 pill。

## 门禁

本次已由 UI 设计员按反馈重新交付 HTML 原型。决策 3、4 已确认；修订后的决策 1、2仍需用户再次明确批准。批准前不修改生产代码、不进入 implementing。
