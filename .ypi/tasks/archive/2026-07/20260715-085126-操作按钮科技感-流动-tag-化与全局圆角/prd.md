# PRD

## 目标与背景

当前侧栏底部四个入口和 Chat 顶部操作区偏平直、分隔栏式，视觉语言不统一。目标是在不改变功能和信息架构的前提下，将两组高频操作升级为圆角 action tag，并让局部亮色沿矢量图标的可见 stroke/path 线条流动，增强科技感；同时建立可复用的全局按钮圆角基线。

原“按钮边框沿边微光”方案已根据用户反馈作废。按钮边框保持静态，仅表达可点击边界与 active/open 状态。

## 用户价值

- 高密度操作更容易被识别为独立可点击项。
- 顶部与左下角操作形成一致视觉语言。
- 动效集中在图标语义线条上，避免大面积背景或边框动画干扰内容和状态 badge。
- 深浅主题、移动端和减少动态偏好下仍保持清晰可用。

## 范围内

1. 左侧栏底部 Models、Usage、Skills、Settings 四按钮。
2. Chat 顶部侧栏开关、主题、Export、Branches、System、Subagents、Git、Terminal；状态统计 chip 和 ChatGPT quota panel 不改业务结构，只确认视觉不冲突。
3. 目标 inline SVG 图标的 base stroke + dynamic overlay stroke 表达。
4. 新增共享按钮圆角、静态表面、图标流动与 motion token / scoped class。
5. 普通按钮全局圆角基线与明确例外策略。
6. 深色、浅色、desktop、`<=640px` 和 `prefers-reduced-motion`。
7. hover、focus-visible、active/open、disabled、dirty/running badge 状态。

## 范围外

- 不改变按钮顺序、文案、图标语义、点击行为、弹层内容或数据流。
- 不做按钮边框、背景或整块图标的持续扫光。
- 不为所有页面做无差别视觉重构；圆形、pill、分段和特殊控件保留语义形状。
- 不引入动画库、WebGL、canvas、运行时计时器或新主题配置项。
- 不改变 top bar 高度、侧栏宽度持久化、移动端横向滚动或面板定位契约。

## 需求与验收标准

### R1 左下角四按钮 tag 化

- 四按钮呈独立 pill tag，而不是透明文字块。
- 默认、hover、focus-visible、pressed、disabled 可区分。
- 260px 默认宽度下四项完整单行排列；220px 下采用 2×2，不溢出、不遮挡。
- Skills 禁用态不出现图标流动，仍可读但不暗示可点击。

### R2 Chat 顶部操作 tag 化

- Export、Branches、System、Subagents、Git、Terminal 及左侧两个图标操作形成同一圆角语言。
- active/open 使用背景、静态边框和文字/图标共同表达，不依赖顶部 2px 色条或颜色单一线索。
- Subagents running/completed 与 Git dirty badge 保持可见，不与图标流动混淆。
- 移动端保留横向滚动和文字隐藏策略，图标按钮仍有 aria-label/title。

### R3 图标线条颜色流动

- 流动只出现在目标 inline SVG 的可见 stroke/path 线条中：基础描边之上叠加局部渐变亮色 stroke，亮色段沿线条行进。
- 不允许按钮边框/背景持续扫动，也不以整块图标统一闪烁替代线条流动。
- 侧栏可用图标默认低频错峰流动；顶栏图标默认静态，仅 hover、focus-visible、active/open 时流动。
- 装饰 overlay 不改变 SVG 尺寸、布局和可访问树，不拦截 pointer event，不遮盖 badge。
- `disabled` 与 `prefers-reduced-motion: reduce` 下取消持续动画；保留静态基础图标和 active/open 表面状态。
- 只使用 inline SVG 与 CSS `stroke`、`stroke-dasharray`、`stroke-dashoffset`/gradient 等轻量机制，不新增动画库或运行时计时器。

### R4 全局圆角基线

- 建立可复用 radius token，普通按钮默认至少 8px 圆角。
- action tag 使用 pill radius；圆形图标按钮、分段按钮外缘及显式特殊控件允许例外。
- 禁止通过 `button { ... !important }` 破坏显式组件形状。
- 本次至少迁移 AppShell 两组目标按钮和 BranchNavigator inline trigger；共享 token/class 可供后续页面复用。

### R5 主题、可访问性与兼容

- 使用现有主题变量及 `color-mix()` 派生静态表面和流动色；深浅主题均有足够边界与图标对比。
- 键盘 `focus-visible` 有稳定 outline/ring；disabled 不响应 hover/动画。
- 动态 overlay 为 `aria-hidden` 的视觉装饰；按钮可访问名称、DOM 顺序、事件处理和弹层锚点不变。
- Chromium/Safari 当前支持范围内不出现布局跳动；SVG gradient/dash 高级效果异常时至少回退为可读的静态 `currentColor` 基础描边。

## 决策状态

1. **待再次批准**：流动位于图标可见 stroke/path 线条，使用局部渐变亮色段；按钮边框保持静态。
2. **待再次批准**：侧栏默认低频错峰；顶栏仅 hover/focus/active 流动；disabled/reduced-motion 静态。
3. **已批准**：260px 单行四列；220px 2×2，保留完整图标与文案。
4. **已批准**：普通按钮 8px 基线；action tag pill；圆形/分段/特殊控件保留例外。
