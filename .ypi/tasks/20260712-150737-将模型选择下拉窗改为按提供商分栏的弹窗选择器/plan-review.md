# 模型选择器改造计划审批书

## 审批结论请求

本任务计划将聊天与 Settings 共用的模型下拉层改为 viewport 模态选择器，桌面按 provider 独立分栏，窄屏改为单列 provider 分组。模型 API、provider/modelId 值、set_model 流程和 Settings 保存契约均不改变。

**当前可以批准进入实现。** UI 原型已由 `ui-designer` 完成交付：[model-selector-prototype.html](model-selector-prototype.html)。请用户审阅本计划与 HTML 原型，确认后即可授予实现许可。

## 审批要点

- PRD：解决窄下拉中跨 provider 浏览成本，保留统一检索和选择即生效。
- UI：推荐 provider 并列栏、自适应网格、移动单列；Settings 的“模型策略”作为独立首栏。
- Design：仅重构共享 `ModelSelect` 展示层；保留 props 和 API 契约，重点处理嵌套 modal 焦点、滚动锁和键盘顺序。
- Implement：先 HTML 原型审批，再共享组件实现、调用方回归、检查和独立评审。
- Checks：lint/typecheck 加聊天、Settings、桌面/移动、键盘、主题、缩放人工验收。

## 需用户确认

1. 批准“provider 并列列 + 窄屏单列分组”，还是改为“左 provider 导航 + 右模型列表”。
2. 批准 Settings 的“模型策略”作为固定独立首栏。
3. 批准选中后立即生效并关闭，保持当前行为。
4. HTML 原型生成后，确认视觉密度、provider 多时的网格滚动方式和移动布局。

## 相关材料

- [Brief](brief.md)
- [PRD](prd.md)
- [UI 门禁与原型任务单](ui.md)
- [Technical Design](design.md)
- [Implementation Plan](implement.md)
- [Checks](checks.md)
- HTML 原型：[model-selector-prototype.html](model-selector-prototype.html)

## 审批状态

- 计划：等待用户审批
- HTML 原型：已交付，等待用户确认
- 实现许可：未授予
