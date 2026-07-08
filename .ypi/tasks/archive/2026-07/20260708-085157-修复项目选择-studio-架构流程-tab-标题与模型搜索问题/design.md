# design

## 方案摘要

按最小可回归范围修复：项目选择只改前端注册/重复分支；Studio 门禁改默认成员/流程/运行时提示；Tab 标题增加 project linkage 匹配和共享 fallback；模型搜索通过 `/api/models` 暴露 provider display name 并注入 `ModelSelect` keywords。

## 影响模块和边界

| 修复项 | 主要文件 | 边界 |
| --- | --- | --- |
| 项目选择 | `components/SessionSidebar.tsx` | 不改 Project Registry 存储；利用现有 `/api/projects` `{ created }`。 |
| Studio UI 门禁 | `lib/ypi-studio-agents.ts`, `lib/ypi-studio-workflows.ts`, `lib/ypi-studio-extension.ts`, `.ypi/agents/*.md`, `.ypi/workflows/*.json` | 默认模板影响新项目；本仓库本地 `.ypi` 需同步，旧自定义项目不强行覆盖。 |
| Tab 标题 | `components/AppShell.tsx`, `lib/workspace-title.ts`, `app/layout.tsx` | 不改变 tab/session 状态，仅改变标题选择规则。 |
| 模型搜索 | `app/api/models/route.ts`, `hooks/useAgentSession.ts`, `components/ChatInput.tsx`, `components/SettingsConfig.tsx`, `components/ModelSelect.tsx` | `provider/modelId` value 与 set_model API 不变；只增加显示/搜索字段。 |

## 数据流 / API / 文件契约

### 项目选择

1. `POST /api/projects/select-directory` 仍只负责本地 OS folder picker，返回 `{ path }`。
2. 前端拿到 `path` 后调用 `POST /api/projects`。
3. 若 `created: true`：更新 `projects`、`selectedProjectId`、`selectedSpaceId`、`selectedCwd`。
4. 若 `created: false`：只更新项目缓存/提示，不调用 selected setters，避免“添加”入口变成“切换”。

### Studio 门禁

- 架构师 prompt：把 UI 门禁写成 MUST，而不是“判断是否需要”。
- Workflow：feature-dev/bugfix planning 指令为条件门禁；ui-change planning/awaiting_approval requiredArtifacts 包含 `ui.md`。
- Runtime prompt：`buildStudioState()` planning 提示和 `ypi_studio_task` promptSnippet 加入 UI prototype gate，覆盖旧 workflow JSON 的运行时提示不足。
- Checker prompt/checks：检查 UI 变更是否有 HTML prototype 与用户审批记录。

### Tab 标题

新增/调整纯 helper：

- `normalizeWorkspacePathForTitle(path)`：统一 slash、去 trailing slash，Windows 可小写盘符/路径。
- `sameWorkspacePathForTitle(a,b)`：用于标题匹配，避免 trailing slash 导致 fallback。
- `projectContextMatchesBrowserTitle(context, selectedSession, newSessionProjectContext, cwd)`：AppShell 内可实现或抽 pure helper；优先 projectId/spaceId，再路径归一化。

标题决策：

```text
if project context matches selected session/new session/current cwd:
  title = `${projectName}(${spaceName})`
else:
  title = formatWorkspaceTitle(cwd, git)
```

`app/layout.tsx` 默认 title 改为 `WORKSPACE_TITLE_FALLBACK`，避免硬编码分叉。

### 模型搜索

`GET /api/models` 的 `modelList[]` 增加可选字段：

```ts
{
  id: string;
  name: string;
  provider: string;
  providerDisplayName?: string;
}
```

后端从 `registry.getProviderDisplayName(m.provider)` 取值。前端 `ModelSelectOption.keywords` 加入 `providerDisplayName`、`${providerDisplayName}/${model.name}`、`${providerDisplayName}/${model.id}`；`group` 可优先 display name，`detail` 保留 provider id。

## 兼容性、风险、回滚

- 项目选择 duplicate 不再自动切换，可能改变少数用户习惯；项目列表本身仍可切换，回滚只需恢复 duplicate 分支的 selected setters。
- Workflow 默认改动不会自动覆盖自定义 `.ypi`；需要同步本仓库 `.ypi` 或通过初始化提示用户更新。
- Tab 标题匹配不能在浏览器端 realpath；projectId/spaceId 匹配可覆盖 linked session，legacy session 仍只能路径归一化 fallback。
- `/api/models` 增加字段为 additive；旧前端忽略，新前端对字段 optional 处理。
