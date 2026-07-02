# Checks

## 需求覆盖检查

- [ ] `lib/ypi-studio-agents.ts` 默认 `ui-designer` 模板明确写明“必须输出 HTML 格式原型图”。
- [ ] `.ypi/agents/ui-designer.md` 在确认仍为默认模板后同步了同样要求。
- [ ] 旧文案不再允许用 Markdown、表格、Mermaid、ASCII 替代 HTML 原型。
- [ ] 模板明确要求 HTML 原型在最终交付/进入实现前上报主会话或用户审阅。
- [ ] 模板明确“确认前不进入实现”或同等门禁。
- [ ] 自定义成员模板仍不会被覆盖，只会 `skipped` / warning。

## 质量检查

- [ ] 旧默认哈希识别支持多个已知默认版本，未丢失现有 `d728c01f248087c6e5196cd0cbef84a2464027cf30e0ff5f69aabed627990a56`。
- [ ] 新增当前默认哈希 `e8957ea09b0b276701a70fcd243a759f9d51c8c1957dc00836bbad454637880d` 以便旧工作区安全迁移。
- [ ] 没有改动 API 响应结构、工作流状态或前端展示契约。
- [ ] 文案保持成员模板风格一致，中文明确、无歧义。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

补充静态检查：

```bash
rg "Markdown、表格、Mermaid、ASCII|ASCII 或 HTML|可使用 Markdown" lib/ypi-studio-agents.ts .ypi/agents/ui-designer.md
rg "HTML" lib/ypi-studio-agents.ts .ypi/agents/ui-designer.md
```

## 手工验收

- 新工作区初始化后，`.ypi/agents/ui-designer.md` 含 HTML 原型和用户审阅门禁要求。
- 用旧默认 `ui-designer.md` 的工作区执行初始化/回填时返回 `updated`。
- 用自定义 `ui-designer.md` 的工作区执行初始化/回填时返回 `skipped`，内容不被覆盖。
- YPI Studio Members 面板仍能读取和预览 UI 设计员成员文件。

## 回归风险

- 最大风险是误覆盖用户自定义模板；检查员需重点确认仍是精确哈希匹配更新。
- 次要风险是只保留一个旧哈希导致更早默认模板无法迁移；应保留多哈希集合。
- 若未来要求独立 `.html` 文件，需另行设计任务 artifact 支持和预览体验；本任务不处理。
