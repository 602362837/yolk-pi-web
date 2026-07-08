# implement

## 执行步骤

1. 先读本计划列出的文件和附近代码，确认没有未提交的用户改动会被覆盖。
2. 按 Implementation Plan 子任务实施；第 2 项涉及工作室成员/流程定义，可直接修改默认模板和本仓库 `.ypi` 配置，因为任务明确要求。
3. 更新相关模块文档：`docs/modules/frontend.md`、`docs/modules/api.md`、`docs/modules/library.md` 中对应条目。
4. 运行验证命令和手工验收。

## 需先阅读的文件

- `docs/modules/frontend.md`
- `docs/modules/api.md`
- `docs/modules/library.md`
- `docs/architecture/overview.md`
- `docs/standards/code-style.md`
- `components/SessionSidebar.tsx`
- `components/AppShell.tsx`
- `lib/workspace-title.ts`
- `components/ModelSelect.tsx`
- `components/ChatInput.tsx`
- `components/SettingsConfig.tsx`
- `hooks/useAgentSession.ts`
- `app/api/models/route.ts`
- `lib/ypi-studio-agents.ts`
- `lib/ypi-studio-workflows.ts`
- `lib/ypi-studio-extension.ts`

## Implementation Plan

| id | title | phase | dependsOn | files |
| --- | --- | --- | --- | --- |
| project-picker-add-semantics | 文件夹选择器按“添加项目”处理重复/新增分支 | frontend | [] | `components/SessionSidebar.tsx` |
| studio-ui-prototype-gate | 增强 Studio 架构/UI 原型审批门禁 | studio | [] | `lib/ypi-studio-agents.ts`, `lib/ypi-studio-workflows.ts`, `lib/ypi-studio-extension.ts`, `.ypi/agents/*.md`, `.ypi/workflows/*.json` |
| browser-title-rule | 修复 Tab 标题 project context 匹配 | frontend | [] | `components/AppShell.tsx`, `lib/workspace-title.ts`, `app/layout.tsx` |
| model-provider-search | 模型搜索匹配 provider display name | frontend-api | [] | `app/api/models/route.ts`, `hooks/useAgentSession.ts`, `components/ChatInput.tsx`, `components/SettingsConfig.tsx`, `components/ModelSelect.tsx` |
| docs-validation | 更新文档并执行验证 | validation | all prior | `docs/modules/*.md` |

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "summary": "修复项目添加语义、Studio UI 原型门禁、浏览器标题规则和模型 provider 名称搜索。",
  "strategy": "independent-fixes-then-validation",
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "project-picker-add-semantics",
      "title": "文件夹选择器按添加项目处理",
      "phase": "frontend",
      "order": 1,
      "dependsOn": [],
      "files": ["components/SessionSidebar.tsx", "docs/modules/frontend.md"],
      "instructions": "拆分项目注册 helper 的 created=true/false 分支。文件夹选择和手动路径添加都必须调用 POST /api/projects；created=true 时加入并选中新项目；created=false 时不改变 selectedProjectId/selectedSpaceId/selectedCwd，只显示已存在提示。保留从项目列表切换的既有入口。",
      "acceptance": ["选择新目录会注册并选中主空间", "选择已存在目录不切换当前项目", "手动路径和文件夹选择 duplicate 行为一致"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "手工选择新目录和重复目录"],
      "risks": ["用户过去可能依赖重复添加来快速切换；需要提示从列表切换"],
      "parallelizable": true,
      "localReview": { "required": true, "focus": "确保 duplicate 分支没有 selected setters 或 router/session side effects" }
    },
    {
      "id": "studio-ui-prototype-gate",
      "title": "增强 Studio 架构/UI 原型审批门禁",
      "phase": "studio",
      "order": 2,
      "dependsOn": [],
      "files": ["lib/ypi-studio-agents.ts", "lib/ypi-studio-workflows.ts", "lib/ypi-studio-extension.ts", ".ypi/agents/architect.md", ".ypi/agents/checker.md", ".ypi/workflows/feature-dev.json", ".ypi/workflows/bugfix.json", ".ypi/workflows/ui-change.json", "docs/modules/library.md", "docs/architecture/overview.md"],
      "instructions": "在架构师默认 prompt 中加入 MUST：页面/前端功能/交互/审批体验变化必须指派 UI 设计员产出 HTML 原型并请求用户审批。强化 checker prompt。更新默认 workflow planning 指令；ui-change workflow 的 awaiting_approval 也要求 ui.md。更新 ypi_studio_extension 的 planning/runtime prompt snippet，覆盖旧 workflow JSON。同步本仓库 .ypi 本地成员与 workflow 文件。",
      "acceptance": ["architect prompt 明确未来页面变更必须 UI designer HTML prototype", "ui-change 任务审批前 requiredArtifacts 包含 ui.md", "feature-dev/bugfix planning 指令包含条件 UI 门禁", "checker 能把缺失 HTML 原型/审批视为阻塞"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "npm run test:studio-dag", "Studio 面板检查 workflow detail 和 member markdown"],
      "risks": ["默认 workflow 初始化不会覆盖用户自定义项目；本仓库需同步 .ypi，其他项目需重新初始化或手动更新", "只做声明门禁不是强 schema 条件校验"],
      "parallelizable": true,
      "localReview": { "required": true, "focus": "确认硬审批 gate 未被放宽，且不递归派发 Studio 成员" }
    },
    {
      "id": "browser-title-rule",
      "title": "修复 Tab 标题 project context 匹配",
      "phase": "frontend",
      "order": 3,
      "dependsOn": [],
      "files": ["components/AppShell.tsx", "lib/workspace-title.ts", "app/layout.tsx", "docs/modules/frontend.md", "docs/modules/library.md"],
      "instructions": "把默认 metadata title 复用 WORKSPACE_TITLE_FALLBACK。为标题匹配增加路径归一化，并在 selectedSession.projectId/spaceId 或 newSessionProjectContext 与 activeProjectContext 匹配时优先使用 Project(Space)，不要仅依赖 cwd 字符串相等。保留 no-context fallback。",
      "acceptance": ["已登记项目标题稳定为 Project(Space)", "linked session cwd 与 registry path 字符串差异时不回退到 repo basename", "无项目上下文仍显示 cwd/Git fallback"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "手工打开项目/linked session/未登记路径观察 document.title"],
      "risks": ["浏览器端无法 realpath；projectId/spaceId 匹配必须优先", "Next metadata 和客户端 title 写入需避免闪烁"],
      "parallelizable": true,
      "localReview": { "required": true, "focus": "标题匹配条件不会把错误项目上下文套到 unrelated cwd" }
    },
    {
      "id": "model-provider-search",
      "title": "模型搜索匹配 provider display name",
      "phase": "frontend-api",
      "order": 4,
      "dependsOn": [],
      "files": ["app/api/models/route.ts", "hooks/useAgentSession.ts", "components/ChatInput.tsx", "components/SettingsConfig.tsx", "components/ModelSelect.tsx", "docs/modules/api.md", "docs/modules/frontend.md"],
      "instructions": "在 /api/models modelList 项增加 providerDisplayName，来自 registry.getProviderDisplayName(provider)。更新 hook 和组件类型。ChatInput/Settings 的 ModelSelectOption keywords/group/detail 加入 providerDisplayName，同时保持 value 和 onModelChange(provider, modelId) 不变。更新搜索提示文案。",
      "acceptance": ["搜索 provider id 可匹配", "搜索 provider display name/中文名可匹配", "聊天和设置模型策略下拉一致", "set_model payload 不变"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "手工搜索 openai-codex 和其展示名"],
      "risks": ["provider display name 可能等于 id；keywords 去重不是必须但避免空字符串", "旧 API shape 需要 optional 字段兼容"],
      "parallelizable": true,
      "localReview": { "required": true, "focus": "API 增量字段和 TS 类型同步" }
    },
    {
      "id": "docs-validation",
      "title": "更新文档并验证",
      "phase": "validation",
      "order": 5,
      "dependsOn": ["project-picker-add-semantics", "studio-ui-prototype-gate", "browser-title-rule", "model-provider-search"],
      "files": ["docs/modules/frontend.md", "docs/modules/api.md", "docs/modules/library.md", "docs/architecture/overview.md"],
      "instructions": "更新模块文档中 SessionSidebar、AppShell、ModelSelect、/api/models、YPI Studio agents/workflows/extension 的描述。运行 lint、tsc 和 Studio DAG 测试；记录手工验收结果。",
      "acceptance": ["文档与实际行为一致", "验证命令通过或有明确阻塞", "handoff 记录变更文件和风险"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "npm run test:studio-dag"],
      "risks": ["文档遗漏会误导后续 agent"],
      "parallelizable": false,
      "localReview": { "required": true, "focus": "需求四项全部覆盖" }
    }
  ]
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-dag
```

## 检查门禁

- 不得 commit/push。
- 第 2 项必须把“未来页面变更必须让 UI designer 出 HTML 原型并经用户审批”写入架构流程门禁。
- 若实现过程中发现需要强制 schema 校验而非文案门禁，先回报主会话决策，不自行扩大。
