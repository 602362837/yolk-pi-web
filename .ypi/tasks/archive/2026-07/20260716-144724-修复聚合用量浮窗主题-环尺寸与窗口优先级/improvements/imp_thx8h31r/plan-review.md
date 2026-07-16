# 改进计划：非聚合用量浮窗改为焦点触发

## 范围
仅修改 standalone/non-aggregate GPT、Grok、Kiro 用量浮窗触发方式；聚合模式保持当前行为不变。

## 方案
- provider trigger 获得 keyboard focus 或 pointer hover 时打开详情。
- trigger 与浮窗组成同一交互区域，离开后使用短暂 grace 延迟关闭，避免移动到面板时闪退。
- Escape 关闭并恢复焦点；设置 suppression，避免 focus restore 立即重开。
- 普通 blur/mouseleave 不抢焦点；保留现有 provider 刷新、账号、Models 等操作。
- 移除 standalone click-primary 依赖，但保留原生 button、aria-expanded、aria-controls 和 focus-visible。
- 聚合模式不改。

## 产物
- [PRD](./prd.md)
- [Design](./design.md)
- [Implement](./implement.md)
- [Checks](./checks.md)
- [UI 说明](./ui.md)

## 审批请求
请确认“standalone 用量浮窗由 hover/focus 触发、聚合模式保持不变”。确认后进入实现。