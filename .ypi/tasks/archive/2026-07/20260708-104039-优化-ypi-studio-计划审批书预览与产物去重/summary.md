# Summary

已完成 YPI Studio 计划审批书预览与产物去重优化。

## 主要变更
- 新增 `plan-review.md` 标准 artifact，作为 awaiting_approval 阶段的主审阅入口。
- 架构/流程 prompt 要求 planning 阶段生成计划审批书，并使用 Markdown 相对链接引用 PRD、Design、Implement、Checks、UI 原型等关键产物。
- 任务详情新增“计划审批书”Tab；awaiting_approval 状态默认优先展示并高亮。
- `MarkdownBody` 支持可选 `onLinkClick`，默认行为不变；审批书预览启用受控相对链接处理。
- 新增任务目录文件 preview API：支持任务目录内安全相对文件读取/HTML 预览，拒绝 scheme、绝对路径、`..` 逃逸、目录目标与符号链接逃逸。
- 产物 Tab 重构为 canonical 去重与固定排序，避免 `prd` / `prd.md` 等重复项。
- 修复审批门禁安全问题：`awaiting_approval -> implementing` 不再从 assistant-controlled transition reason 合成 approvalGrant，只接受后续用户输入记录的 grant。
- 更新架构/API/前端/库文档。

## 验证
- `npm run lint` passed
- `node_modules/.bin/tsc --noEmit` passed
- checker 复查 passed
