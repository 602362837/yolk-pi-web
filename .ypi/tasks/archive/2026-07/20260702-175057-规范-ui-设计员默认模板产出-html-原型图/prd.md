# PRD

## 目标与背景

规范 YPI Studio 默认 `ui-designer` 成员模板：UI 设计员必须产出可直接审阅的 HTML 格式原型图，并在交付实现前明确上报给主会话/用户审阅。当前默认模板允许 Markdown、表格、Mermaid、ASCII 或 HTML 草图，导致原型形式不稳定，可能无法直接交付用户预览。

## 范围内

- 更新 `lib/ypi-studio-agents.ts` 中默认 `ui-designer` 模板文案。
- 同步更新本仓库 `.ypi/agents/ui-designer.md`，前提是它仍是默认模板内容而非用户自定义内容。
- 更新默认模板迁移识别逻辑，使旧工作区中“精确匹配旧默认模板”的 `ui-designer.md` 可被安全更新。
- 保持自定义成员模板只提示/跳过，不自动覆盖。

## 范围外

- 不新增 UI 原型渲染器、预览页面或新文件类型支持。
- 不改变 YPI Studio 工作流状态机和用户审批 API。
- 不强制检查 UI 设计员真实输出中是否包含合法 HTML；本任务只规范默认模板和初始化/迁移行为。

## 需求与验收标准

1. 默认模板必须要求 `ui-designer` 输出 HTML 原型图。
   - 验收：`lib/ypi-studio-agents.ts` 和默认生成的 `.ypi/agents/ui-designer.md` 不再说原型可用 Markdown/表格/Mermaid/ASCII 替代 HTML。
2. 默认模板必须要求 HTML 原型在最终交付前上报给主会话/用户审阅。
   - 验收：模板含有明确门禁：HTML 原型需先提交主会话/用户确认，确认前不进入实现。
3. 不覆盖用户自定义成员模板。
   - 验收：初始化/回填仍只创建缺失默认文件，或更新精确匹配已知默认哈希的文件；未知内容返回 `skipped`。
4. 旧默认模板可安全迁移。
   - 验收：当前仓库默认 `ui-designer.md` 的旧哈希 `e8957ea09b0b276701a70fcd243a759f9d51c8c1957dc00836bbad454637880d` 被纳入安全迁移识别；已有更老默认哈希不应意外丢失。
5. 质量门禁通过。
   - 验收：`npm run lint`、`node_modules/.bin/tsc --noEmit` 通过，或在交付中说明未运行原因。

## 未决问题

- 是否要求 HTML 原型必须是独立 `.html` 文件？建议本次不强制；默认模板要求在交付中提供自包含 HTML（可为 fenced `html` 代码块或明确文件路径）即可，避免新增任务 artifact 类型。
