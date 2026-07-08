# brief

## 任务目标

修复 4 个已定位的产品/工作流问题：

1. 左侧项目下拉的文件夹选择器必须执行“添加项目”语义，不能把已登记项目的切换伪装成添加。
2. YPI Studio 架构流程增加 UI 原型门禁：凡涉及页面变更、前端功能新增、交互变化或审批体验变化，架构师必须指派 UI 设计员基于现有项目产出 HTML 原型并交给用户审批。
3. 浏览器 Tab 标题偶发显示 cwd basename（如 `pi-agent-web`）时，应回到项目已有规则：优先 `Project(Space)`，否则才使用工作区/Git fallback。
4. 模型选择下拉搜索同时匹配 provider id 和提供商展示名称。

## 关键证据

- 项目选择入口：`components/SessionSidebar.tsx` 的 `handleDirectoryPicker()` 调用 `/api/projects/select-directory` 后复用 `registerAndSelectProjectPath()`；`POST /api/projects` 会返回 `{ created }`。
- 项目注册去重：`lib/project-registry.ts` 对相同 `pathKey` 的活跃项目返回 `created: false`。
- Studio 默认成员/流程：`lib/ypi-studio-agents.ts`、`lib/ypi-studio-workflows.ts`；UI 设计员模板已要求 HTML 原型，但架构师和 feature-dev/bugfix 流程仍只是软性“判断是否需要 UI”。
- Studio prompt 注入：`lib/ypi-studio-extension.ts` 的 `buildStudioState()` 和工具 `promptSnippet` 会影响当前运行任务的行为。
- Tab 标题规则：`components/AppShell.tsx` 当前使用 `activeProjectContext?.cwd === browserTitleCwd` 才显示 `Project(Space)`，否则回落到 `formatWorkspaceTitle()`；`lib/workspace-title.ts` 定义 fallback。
- 模型搜索：`components/ModelSelect.tsx` 已按 `provider/group/keywords` 搜索；缺口在 `/api/models` 和调用方未提供 provider display name。

## 约束

- 不直接实现生产代码；本交付仅为设计与实现计划。
- 不 dispatch 其他 Studio 成员；本次仅建议是否需要 UI designer。
- 变更后至少运行 `npm run lint` 与 `node_modules/.bin/tsc --noEmit`。
