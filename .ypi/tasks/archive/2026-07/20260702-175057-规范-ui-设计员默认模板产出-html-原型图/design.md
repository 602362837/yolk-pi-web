# Design

## 方案摘要

以默认成员模板为源头约束 UI 设计员输出：将 `ui-designer` 模板中的“可使用 Markdown、表格、Mermaid、ASCII 或 HTML 草图”改为“必须输出 HTML 格式原型图”，并增加“交付前上报主会话/用户审阅，确认后再进入实现”的门禁说明。初始化/迁移逻辑继续使用精确哈希判断默认模板，避免覆盖自定义成员。

## 影响模块和边界

- `lib/ypi-studio-agents.ts`
  - `DEFAULT_YPI_STUDIO_AGENTS`：更新 `ui-designer` 默认 Markdown 内容。
  - 旧默认模板识别：当前 `OLD_DEFAULT_AGENT_HASHES` 只支持每个文件一个哈希；建议扩展为每个文件多个已知默认哈希，避免本次新增旧哈希时丢失更早版本迁移能力。
  - `isOldDefaultAgent()` / `writeDefaultAgent()`：改为检查“已知旧默认哈希集合”。
- `.ypi/agents/ui-designer.md`
  - 当前文件内容与默认模板一致，可作为本仓库默认成员模板同步更新。
- `docs/modules/library.md`（可选）
  - 若希望文档可发现，可在 `lib/ypi-studio-agents.ts` 条目补一句：默认 UI 设计员模板要求 HTML 原型和用户审阅门禁。不是硬性必须。

不需要改动：API 路由、YPI Studio 工作流 JSON、任务类型、前端组件或渲染逻辑。

## 数据流 / API / 文件契约

- `GET /api/studio/agents` 继续通过 `listYpiStudioAgents()` 返回：
  - `missingDefaultAgents`：缺失默认成员。
  - `outdatedDefaultAgents`：精确匹配已知旧默认哈希的成员。
- `POST /api/studio/agents` 继续通过 `initializeYpiStudioAgents()`：
  - 缺失文件：创建新默认模板。
  - 精确匹配已知旧默认哈希：覆盖为新默认模板并返回 `updated`。
  - 其他已有文件：跳过并返回 `skipped`，必要时保留 warning。

## 兼容性、风险、回滚

- 兼容性：只修改模板文本和哈希迁移判断，不改变 API 响应结构。
- 自定义保护：必须保持“精确哈希匹配才更新”的策略；不要用 frontmatter、version 或片段匹配覆盖文件。
- 迁移风险：如果只把 `ui-designer.md` 的旧哈希替换为新哈希，会导致更早默认模板无法迁移；建议支持多个旧哈希。
- 回滚：恢复 `ui-designer` 模板文本和旧哈希集合即可；已被更新的默认模板文件可再次由新哈希迁移或手动恢复。
