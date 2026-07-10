# Design

## 根因（已由代码静态确认）

`components/AppShell.tsx` 将 `.right-panel-resize-handle` 作为 `.right-panel-container` 的直接子元素渲染。桌面 CSS 中，`.right-panel-container > *` 无差别设置 panel 宽度及 `min-width: 300px`；handle 后续只覆盖 `width: 8px`，并未覆盖 `min-width`。CSS used width 因而至少为 300px。它绝对定位、透明且 `z-index:25`，所以拦截抽屉左侧内容的 pointer 事件。

左侧 sidebar 已有正确先例：通用子元素选择器排除 `.sidebar-resize-handle`，再对 handle 明确约束尺寸。

## 最小安全方案

仅调整 `app/globals.css` 的桌面 right-panel 规则：把固定内容宽度规则从 `.right-panel-container > *` 收窄为 `.right-panel-container > :not(.right-panel-resize-handle)`。保持现有 handle 的 `position/left/width/z-index/touch-action` 不变。必要时 UI/实现评审可要求与 sidebar 一致地为 handle 显式设 `min-width: 0` 和 `max-width: 8px`，但首选先以选择器排除消除继承来源，避免仅靠覆盖规则掩盖未来误匹配。

## 边界与兼容性

- 影响文件：`app/globals.css`；无需 API、数据迁移、localStorage 变更或 React 状态变更。
- 只在 `@media (min-width: 641px)` 生效。移动端已有 `.right-panel-resize-handle { display:none !important; }`，保持不动。
- 所有 mode 共用右侧容器，单一 CSS 修复覆盖 Preview/Studio/Trellis。

## 风险与缓解

- **命中带过窄**：严格回归拖拽，包含缩放/高 DPI；不改变 8px 设计值。
- **通用选择器漏作用于其他直接内容节点**：确认唯一排除的是 handle，内容节点仍获得固定宽度以避免开合动画 reflow。
- **已有未提交功能同时改动此区域**：只做上述一处 CSS 选择器改动，不回退或重排 `AppShell.tsx`。

## 回滚

回滚该 CSS 选择器改动即可恢复原布局（不建议作为常规操作，因为会恢复点击阻塞）。
