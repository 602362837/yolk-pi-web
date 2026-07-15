# Checks

## 需求覆盖

- [ ] 左下角 Models / Usage / Skills / Settings 为独立圆角 tag，顺序和点击行为不变。
- [ ] Chat 顶部侧栏、主题、Export、Branches、System、Subagents、Git、Terminal 使用一致圆角语言。
- [ ] 流动只发生在 inline SVG 可见 stroke/path 线条；按钮边框/背景无持续扫动，整块图标不统一闪烁。
- [ ] active/open 不只依赖顶部色条或颜色；disabled 不响应 hover/动画。
- [ ] 普通按钮 radius token 可复用，圆形、pill、分段和特殊控件未被破坏。
- [ ] 没有 API、配置、session、SSE 或持久化改动。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

补充静态搜索：

```bash
rg -n "ActionFlowIcon|action-flow-icon|tech-action-tag|control-radius|data-icon-flow|stroke-dash" components app/globals.css
rg -n "edge-flow|conic-gradient|button\s*\{[^}]*!important|border-radius:.*!important" app/globals.css components/AppShell.tsx components/BranchNavigator.tsx
```

人工判读：第一组应证明共享 icon-flow 接入；第二组不得出现新按钮边框流动方案或破坏性全局圆角覆盖，已有无关匹配需标注。

## 浏览器人工验收

### 图标线条流动

1. 浅色、深色各检查 1440px：亮色段应沿 path/line/rect/circle 的可见线条移动，base stroke 始终完整可读。
2. 观察按钮外框与背景：只允许静态状态切换，不得持续旋转、扫动或闪烁。
3. 侧栏可用图标默认低频错峰，不应四项同步；Skills disabled 完全静态。
4. 顶栏默认态静态；hover、Tab focus、active/open 时图标线条开始流动，移出/关闭后按策略停止。
5. Export disabled 无 overlay 动画；Subagents/Git badge 不被线条动效遮挡或裁切。
6. 在 Chromium 与 Safari 各验证至少一次：gradient/dash 正常；若模拟禁用 overlay/gradient，base stroke 仍完整。

### Desktop / 主题 / 状态

1. 浅/深主题中 default、hover、focus、active、disabled 的 tag 边界和图标均可辨。
2. 侧栏 260px：四按钮单行、文字不截断。
3. 侧栏 220px：2×2，顺序为 Models、Usage、Skills、Settings，无溢出。
4. 依次打开 System、Subagents、Git、Branches、Terminal：active/open 明确，面板/dropdown 不偏移。
5. 触发 Subagents running/completed 和 Git dirty：角标/勾独立清晰，不与动态图标混淆。

### Mobile / 窄屏

1. 640px、390px、320px 下 top bar 保持 36px 且可横向滚动。
2. 文案隐藏后图标 tag 保持 28×28，title/aria-label 正确，SVG 亮色段不越出 viewBox。
3. 打开侧栏 overlay，底部四按钮无横向溢出；关闭/重开行为不变。
4. 统计 chips、quota panel 和右侧 toggle strip 无重叠回归。

### 键盘 / 动效 / 可访问性

1. Tab 顺序访问所有目标按钮；`focus-visible` 清楚且不依赖图标动画。
2. Enter/Space 与鼠标行为相同；active/open aria 与视觉同步。
3. `prefers-reduced-motion: reduce` 下所有 icon dash 动画停止并隐藏动态 overlay；base stroke 和状态表面保持可辨。
4. decorative overlay 不进入 Accessibility Tree；图标态按钮有可访问名称。
5. SVG/overlay 不拦截点击；badge、文字和 focus ring 未被裁切。

### 全局圆角回归抽样

至少抽样 Settings 主/次按钮、确认对话框、模型选择器、Terminal tab/按钮、文件 diff 模态、分段切换、圆形关闭/浮动按钮：

- 普通按钮至少达到批准的 8px 基线；
- 圆形仍为圆形；
- 分段控件仅外缘圆角、内部连接无裂缝；
- 危险/禁用状态语义未因表面效果降低。

## 重点风险判定

### Blocker

- 动效仍发生在按钮边框/背景，而非图标可见线条；
- reduced-motion 或 disabled 下仍持续线条流动/闪烁；
- overlay 失败导致基础图标消失；
- 目标按钮功能、Branches 锚点或移动横向滚动回归；
- 全局规则破坏圆形/分段/特殊控件；
- 220px 侧栏入口溢出不可达。

### High

- 深/浅主题任一主题图标或边界对比明显不足；
- 顶栏默认大量图标持续快速动画；
- active 仅靠颜色，键盘无可见焦点；
- gradient id 冲突导致多个图标使用错误/缺失 overlay；
- badge 被裁切或与线条动效混淆；
- Safari/Chromium 任一目标浏览器中动态图标大面积填色、消失或严重抖动。

## 验证证据要求

实现员需在 handoff 记录：修改文件、lint/typecheck 结果、实际验证的浏览器/视口/主题/reduced-motion/disabled 状态、SVG fallback 结果及已知偏差。检查员需对照修订原型和本清单给出 blocker/high/remaining findings；存在 blocker/high 时不得完成。
