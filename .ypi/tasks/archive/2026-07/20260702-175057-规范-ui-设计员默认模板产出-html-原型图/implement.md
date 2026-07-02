# Implement

## 执行步骤

1. 阅读并确认上下文：
   - `brief.md`
   - `lib/ypi-studio-agents.ts`
   - `.ypi/agents/ui-designer.md`
   - `docs/modules/library.md`
   - `docs/standards/code-style.md`
2. 更新默认 `ui-designer` 模板文案：
   - 在 `DEFAULT_YPI_STUDIO_AGENTS` 的 `ui-designer` body 中，将核心职责第 4 条改为必须输出 HTML 格式原型图。
   - 在输出格式中将 `### Prototype` 改为或补充 `### HTML Prototype`，要求提供自包含 HTML 原型（推荐 fenced `html` 代码块，或明确 `.html` 文件路径）。
   - 增加 `### Review Request` 或同等说明：交付前必须把 HTML 原型上报主会话/用户审阅，确认前不得进入实现。
   - 在工作原则或写入边界中补充“HTML 原型是 UI 设计交付门禁”。
3. 同步本仓库 `.ypi/agents/ui-designer.md`：
   - 当前文件哈希为 `e8957ea09b0b276701a70fcd243a759f9d51c8c1957dc00836bbad454637880d`，内容是默认模板，可安全同步。
   - 如实现前发现文件已被用户改动且不再匹配已知默认哈希，不要覆盖，改为报告阻塞/风险。
4. 增强旧默认迁移识别：
   - 将 `OLD_DEFAULT_AGENT_HASHES` 从 `Map<string, string>` 扩展为可保存多个哈希，例如 `Map<string, readonly string[]>`。
   - 为 `ui-designer.md` 保留现有旧哈希 `d728c01f248087c6e5196cd0cbef84a2464027cf30e0ff5f69aabed627990a56`，并新增当前默认哈希 `e8957ea09b0b276701a70fcd243a759f9d51c8c1957dc00836bbad454637880d`。
   - 更新 `isOldDefaultAgent()` 和 `writeDefaultAgent()` 的判断为 `knownHashes.includes(sha256Text(existingContent))`。
5. 视情况更新文档：
   - 若实现改动只限模板和迁移逻辑，可不改 API/前端文档。
   - 若想留下可发现说明，可更新 `docs/modules/library.md` 的 `lib/ypi-studio-agents.ts` 条目。

## 推荐模板要点

- “输出低保真原型”应表述为：必须输出 HTML 格式原型图；Markdown 只能用于说明，不可替代 HTML 原型。
- HTML 原型应覆盖主要页面结构、关键组件、主路径和关键状态。
- 最终交付前必须明确向主会话/用户发起审阅请求，并等待确认后再进入实现。

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## 检查门禁

- `rg "Markdown、表格、Mermaid、ASCII|ASCII 或 HTML|可使用 Markdown" lib/ypi-studio-agents.ts .ypi/agents/ui-designer.md` 不应再命中允许替代 HTML 原型的旧说法。
- `rg "HTML" lib/ypi-studio-agents.ts .ypi/agents/ui-designer.md` 应能看到明确的 HTML 原型要求和审阅门禁。
- `POST /api/studio/agents` 行为仍保持：缺失创建、旧默认更新、自定义跳过。
