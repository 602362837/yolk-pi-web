# Plan review

## 当前状态：等待用户审批

本任务已完成 PRD、根因分析、最小修复设计、实施计划与检查计划。目前 UI 设计员已完成 HTML 交互原型的开发交付，**UI prototype gate 已满足**；主会话可向用户审批当前交互原型，之后转入 `awaiting_approval`。

## 关联产物

- [Brief](./brief.md)
- [PRD](./prd.md)
- [UI 交付与交互说明](./ui.md)（已交付 [ui-prototype.html](./ui-prototype.html)）
- [Design](./design.md)
- [Implement](./implement.md)
- [Checks](./checks.md)

## 摘要

- **根因**：`.right-panel-container > *` 向 resize handle 施加了 300px `min-width`；handle 虽视觉为 8px，却以透明、z-index 25 的至少 300px 命中盒覆盖内容。
- **推荐最小修复**：只在 desktop right-panel CSS 把通用内容尺寸选择器排除 `.right-panel-resize-handle`，沿用左侧 sidebar 的现有模式。无需改 React、API、状态或数据。
- **验收**：三种右侧 mode 的内容左侧可点击，同时左缘 8px 仍可调宽；移动端保持没有 resize handle。

## 审批请求

请确认 UI 原型中「桌面左缘 8px 为唯一拖拽带；x=5px 起为内容可点击区」这一行为。HTML 原型和审批记录齐备前不得实施。
