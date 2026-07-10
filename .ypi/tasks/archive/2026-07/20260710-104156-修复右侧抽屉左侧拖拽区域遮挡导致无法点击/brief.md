# Brief

用户反馈：桌面端右侧抽屉打开后，其左缘拖拽区遮挡抽屉内容，导致左侧一大片内容无法点击。

已定位到 `app/globals.css`：通用规则 `.right-panel-container > *` 为所有直接子元素设置 `min-width: var(--right-panel-min-width, 300px)`；新增的绝对定位 `.right-panel-resize-handle` 也是直接子元素。其自身虽声明 `width: 8px`，但没有覆盖 `min-width`，实际命中盒至少 300px，且 `z-index: 25` 覆盖内容。

目标是将桌面端拖拽命中范围恢复为左缘约 8px，保留调宽能力、触控行为和移动端隐藏逻辑；不修改抽屉内容或业务状态。
