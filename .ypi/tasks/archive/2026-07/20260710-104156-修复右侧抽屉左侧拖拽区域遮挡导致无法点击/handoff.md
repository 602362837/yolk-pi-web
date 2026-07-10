# Architect handoff

## 产物

已完成并写入：`brief.md`、`prd.md`、`ui.md`、`design.md`、`implement.md`、`checks.md`、`plan-review.md`、本文件。未修改生产代码。

## 根因与建议

右侧 resize handle 直接匹配 `.right-panel-container > *`，继承 300px `min-width` 后以 `z-index:25` 透明覆盖内容。最小修复是把该通用选择器改为排除 `.right-panel-resize-handle`；左侧 sidebar 已使用同一模式。

## 验证

仅做静态代码/CSS cascade 审查，未运行 lint、type-check 或浏览器验证（规划阶段无代码改动）。实施后按 [Checks](./checks.md) 执行。

## 未决与主会话动作

1. 必须委托 ui-designer 按 [UI](./ui.md) 提交 `ui-prototype.html`。
2. 必须取得用户对 8px 唯一拖拽带的审批；此前不要实现或切换到实现阶段。
3. 审批后保存 [Implement](./implement.md) 的机器可读计划并转入 `awaiting_approval`。

## 风险

当前工作区已有其他未提交的 AppShell/CSS 相关改动；实现员必须局限于单个 CSS 选择器，不能覆盖或回退这些改动。
