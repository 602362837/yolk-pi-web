# brief

## 问题概述

当前工作室默认成员初始化内容在成员正文中直接写出 Trellis / Trellis Agent / active task / manifest / check.jsonl 等来源概念。由于这些成员文件会被初始化到 `.ypi/agents/`、在工作室成员面板预览，并被 `ypi_studio_subagent` 注入为成员提示词，这会把内部参考体系暴露给用户和被派发成员。

## 已确认影响面

- 默认来源：`lib/ypi-studio-agents.ts` 的 `DEFAULT_YPI_STUDIO_AGENTS` 四个成员正文包含直指 Trellis 的描述。
- 已持久化成员：本仓库 `.ypi/agents/{architect,ui-designer,implementer,checker}.md` 已由旧默认内容生成，也包含同样描述；初始化逻辑不会覆盖已有文件。
- 展示面：`components/YpiStudioPanel.tsx` 预览成员 Markdown，`AgentCard` 展示 frontmatter description；当前 description 未提 Trellis，但正文预览会暴露。
- 提示词面：`lib/ypi-studio-extension.ts#buildMemberPrompt` 读取 `.ypi/agents/<member>.md` 全文作为 `Member Definition` 注入给子进程，因此旧成员正文会进入运行提示词。
- 工作流/任务模板：`lib/ypi-studio-workflows.ts` 默认流程、`.ypi/workflows/*.json`、`lib/ypi-studio-tasks.ts` 默认任务产物模板未发现 Trellis 直指；任务标题/事件中出现 Trellis 属于用户当前问题文本，不应迁移清理。

## 期望结果

- 对用户展示和成员初始化文本只呈现“蛋黄派工作室 / YPI Studio”自身语义。
- 内部实现和团队可继续参考 Trellis 的规划/执行/检查经验，但默认成员文件、成员面板和成员提示词不出现 Trellis 名称、`.trellis` 路径或 Trellis 专属术语。
- 对已初始化项目提供安全迁移策略，不覆盖用户自定义成员。
