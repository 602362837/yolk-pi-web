# Design

## 方案摘要

把视觉能力拆为四层：

1. **全局 token**：在 `app/globals.css` 定义普通控制圆角、pill 圆角、静态 transition 和 icon-flow duration/color token。
2. **静态 action-tag primitive**：`.tech-action-tag` 负责尺寸、静态边框/表面、focus、active 和 disabled；按钮边框不承载持续动画。
3. **共享 SVG icon-flow primitive**：建议新增 `components/ActionFlowIcon.tsx`，在一个 inline SVG 中渲染相同几何的 base stroke 与 decorative overlay stroke；overlay 使用渐变 stroke + moving dash。
4. **目标组件接入**：`AppShell.tsx` 两组按钮和 `BranchNavigator.tsx` inline trigger 接入 class/state 与共享图标 primitive；事件、ref、dropdown、badge 和业务数据不变。

原“按钮边框沿边微光/伪元素旋转”技术路径已作废，不得进入实现。

## 现有图标技术盘点

目标按钮图标均是 JSX 内的 **inline SVG**：

- `components/AppShell.tsx`：侧栏开关、主题、Export、System、Subagents、Git、Terminal、Models、Usage、Skills、Settings。
- `components/BranchNavigator.tsx`：Branches trigger。
- 几何由 `path`、`line`、`polyline`、`rect`、`circle` 组成；目标 SVG 普遍为 `fill="none"`、`stroke="currentColor"`、圆角 linecap/linejoin。
- 不存在字体图标、外部 SVG 图片或必须先反向提取 path 的 blocker；也无需 CSS mask 方案。

因此推荐最小语义改动：保留原几何和 viewBox，将几何抽成共享 icon definition/render callback，由 `ActionFlowIcon` 渲染两遍。

## 影响模块和边界

| 模块 | 改动 | 不改 |
| --- | --- | --- |
| `app/globals.css` | radius/motion/color token、静态 action-tag、base/overlay stroke、dash 动画、响应式/reduced-motion | 主题切换、top bar 36px 和横向滚动结构 |
| `components/ActionFlowIcon.tsx`（建议新增） | 统一 inline SVG base/overlay、per-instance gradient id、装饰层 a11y | 不承载按钮状态或业务事件 |
| `components/AppShell.tsx` | 两组按钮 class/state、图标几何接入、删除内联 hover 视觉 | 点击行为、顺序、disabled、badge、面板状态 |
| `components/BranchNavigator.tsx` | inline trigger 接入 tag/icon primitive | 树数据、dropdown 定位、选择逻辑 |
| 其他按钮 | 获得非破坏性的普通圆角基线或复用 token | 不逐页重画；特殊形状不强制覆盖 |
| `docs/modules/frontend.md` | 记录 action-tag / icon-flow primitive 与例外 | 无 API 文档变化 |

## SVG / CSS 契约

建议组件与 class/state：

```text
<ActionFlowIcon viewBox icon geometry ... />
.action-flow-icon
.action-flow-icon__base
.action-flow-icon__overlay
.tech-action-tag
.tech-action-tag--icon
.sidebar-utility-tag
.app-top-action-tag
[data-icon-flow="ambient|interactive|off"]
[aria-expanded="true"] / [aria-pressed="true"] / .is-active / :disabled
```

`ActionFlowIcon` 推荐契约：

- 使用 React `useId()` 生成 per-instance gradient id，并清理为 SVG URL 可用值，避免多个按钮/SSR hydration 的 id 冲突。
- `<g class="...base">` 与 `<g class="...overlay" aria-hidden="true">` 渲染同一组 path/line/rect/circle 几何。
- base 使用 `stroke: currentColor`，保证任何高级效果失败时图标仍完整可读。
- overlay 使用 `stroke: url(#instance-gradient)`、`fill:none`、`stroke-dasharray` 和 `stroke-dashoffset`；动画仅改变 dash offset。
- 若某个图标含语义填充面，需显式拆分 fill 与 stroke；本次目标图标以线性 stroke 为主，不应用整块 fill 动画。
- SVG 本身 `aria-hidden="true"`、`focusable="false"`；可访问名称继续由按钮 label/aria-label 提供。

CSS motion 策略：

- `.sidebar-utility-tag[data-icon-flow="ambient"]`：可用项默认低频，利用 CSS variable/索引错开 delay。
- `.app-top-action-tag[data-icon-flow="interactive"]`：默认 overlay 隐藏，仅 `:hover`、`:focus-visible`、active/open 时启动。
- `:disabled` 与 `[data-icon-flow="off"]`：overlay 隐藏并 `animation:none`。
- `@media (prefers-reduced-motion: reduce)`：所有 overlay animation 为 none，并隐藏动态 overlay；base 和静态状态保留。
- 动画不使用按钮伪元素、不改变 border/background-position、不引入 JS timer。

## Action tag 与全局圆角

- action tag 本体 `position:relative; display:inline-flex; border:1px solid var(--border); border-radius:var(--control-radius-pill)`。
- active/open 同时调整静态 border/background/text，替代顶部 2px 色条。
- focus 使用 2px accent outline + offset，不依赖动画。
- root 提供 `--control-radius: 8px`；可用低 specificity `:where(button)` 建立普通基线。
- inline style、圆形 class、pill class、分段容器与特殊 opt-out 必须能覆盖基线；禁止 `!important`。
- 实施前盘点 `borderRadius: 0`、`border-radius: 0`、`50%`、`999px` 及分段控件。

## 数据流与接口

无网络 API、持久化、JSONL、SSE、配置或数据迁移。现有 React state 仅映射为 aria/class：

```text
selectedSession / activeTopPanel / terminalOpen / sidebarOpen / isDark
  -> aria-expanded / aria-pressed / disabled / tag modifier
  -> static tag state + SVG overlay motion state
```

Branches 继续使用 `topBarRef` 计算 dropdown；不得因 wrapper/padding 改变 anchor 语义。

## 兼容性与降级

- 深浅主题：base 始终使用 `currentColor`；gradient stops 使用主题 token。
- SVG gradient URL：必须 per instance，避免多个 inline SVG 使用重复 id；验证 Safari/Chromium。
- 不支持或异常：隐藏/失效的 overlay 不能影响 base，按钮仍显示完整静态图标。
- reduced-motion：完全取消持续 dash 动画，不以静态亮斑制造误解。
- SSR/hydration：`useId` 稳定，不引入随机值或客户端测量。
- 移动端：不改变 36px top bar 和横向滚动，文字隐藏后仍保留 aria-label/title。

## 风险与缓解

1. **同一几何重复维护导致漂移**：共享 icon geometry/render callback，由 primitive 统一渲染 base/overlay，而不是手工复制两套 path。
2. **SVG gradient id 冲突或 Safari 解析差异**：per-instance `useId`；base stroke 独立存在；做双浏览器验证。
3. **不同 path 长度导致 dash 速度不一致**：按 viewBox/图标复杂度选择统一视觉节奏，必要时按 icon modifier 微调 dasharray，而非运行时测长。
4. **动效噪声/耗电**：ambient 只限侧栏、低频错峰；顶栏仅交互/active；reduced-motion 和 disabled 关闭。
5. **badge 或 focus 被裁切**：SVG overlay 保持在 viewBox 内；按钮不以 overflow 裁切外部 focus/badge。
6. **全局圆角破坏特殊控件**：低 specificity、无 `!important`、显式例外和浏览器抽样。
7. **dropdown 锚点偏移**：保持 BranchNavigator 外层和 topBarRef 尺寸契约。

## 回滚

删除新增 token/class/`ActionFlowIcon`，恢复 `AppShell.tsx` 和 `BranchNavigator.tsx` 原 inline SVG/视觉样式即可；无数据回滚或迁移。
