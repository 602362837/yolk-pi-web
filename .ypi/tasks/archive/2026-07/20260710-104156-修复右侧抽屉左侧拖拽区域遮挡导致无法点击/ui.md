# UI

## UI prototype gate：已满足

这是已有页面的可见交互修复（点击命中区与拖拽边界变化）。已由 **ui-designer** 交付 HTML 原型并在此完成交互说明标注。

- **原型路径**：[.ypi/tasks/20260710-104156-修复右侧抽屉左侧拖拽区域遮挡导致无法点击/ui-prototype.html](./ui-prototype.html)
- **演示方案**：提供 Buggy/Fixed 对比模式，验证 desktop >640px 断点下 resize handle 宽度与点击穿透命中，并兼容 Preview/Studio/Trellis 各抽屉面板的交互操作。

## 交互设计标注与状态

### Interaction States

| 场景 | 展示 | 用户操作 | 反馈 |
| --- | --- | --- | --- |
| 桌面端默认态 | 右侧面板左边缘有微弱的 8px z-index:25 隐形边缘 | 鼠标悬浮于左边缘 0-8px | 鼠标指针变为 `col-resize`，拖拽条高亮呈 `rgba(37,99,235,0.08)` 蓝色半透明条 |
| 桌面端拖拽中 | 指针为 `col-resize`，拖拽条呈现 `rgba(37,99,235,0.12)` 高亮 | 向左/右拖曳鼠标 | 右侧面板无延迟缩放，宽度同步发生改变，最小值 clamp 在 300px，最大值 clamp 在 65vw 且持久化保存 |
| 内容点击 | 点击抽屉内 x >= 5px 的按钮、Tab 或目录树节点 | 鼠标点击操作 | 直接命中抽屉内部各操作组件，触发业务行为，不发生 resize 阻挡，不影响拖曳条响应 |
| 移动端模拟 | 右侧抽屉以 100vw 全屏覆盖呈现 | 尝试寻找/悬浮左边缘 | 无 resize 拖曳条，元素不响应拖拽，`display: none`，内容直接满宽点击 |

## 推荐交互

- 桌面 handle 视觉和命中宽度均为 8px，布局位置 `left: -4px`，即约 4px 在抽屉外、4px 在抽屉内。
- 不用 `pointer-events: none`、降低 z-index 或改变内容层级解决问题；这些会损害拖拽或引入 mode 间差异。通过仅将通用宽度规则应用至 `:not(.right-panel-resize-handle)` 排除继承的 `min-width: 300px`。

## 审批请求

请用户确认「左缘 8px 为唯一拖拽带、其余内容可点击」的原型。未取得 HTML 原型和审批前，不进入实现。

