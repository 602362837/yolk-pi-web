# Summary

## 完成内容

- 更新 `lib/ypi-studio-agents.ts` 中默认 `ui-designer` 模板：
  - 明确 UI 设计员必须输出 HTML 格式原型图。
  - 明确 Markdown、表格或图示只能作为补充，不能替代 HTML 原型。
  - 新增 `HTML Prototype` 输出段落要求。
  - 新增 `Review Request` 审阅请求段落，要求交付实现前上报主会话 / 用户审阅。
  - 明确获得确认前不得进入实现阶段。
- 同步更新当前项目 `.ypi/agents/ui-designer.md`。
- 将旧默认模板迁移逻辑从单 hash 扩展为多 hash 精确匹配：
  - 保留既有旧 hash `d728c01f248087c6e5196cd0cbef84a2464027cf30e0ff5f69aabed627990a56`。
  - 新增当前旧默认 hash `e8957ea09b0b276701a70fcd243a759f9d51c8c1957dc00836bbad454637880d`。
  - 仍只覆盖精确匹配已知默认模板的文件，不覆盖用户自定义模板。
- 更新 `docs/modules/library.md`，记录 UI 设计员默认模板的 HTML 原型与用户审阅门禁要求。

## 验证

- `npm run lint` — 通过。
- `node_modules/.bin/tsc --noEmit` — 通过。
- 静态搜索确认旧的“Markdown/表格/Mermaid/ASCII 可替代 HTML”说法已移除。
- hash 检查确认旧默认迁移白名单保留多个已知默认 hash。

## 检查结论

检查员结论：Pass。无剩余阻塞问题。
