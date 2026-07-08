# prd

## 目标与背景

提升 YPI Web 的项目选择、工作室规划门禁、浏览器标题和模型搜索一致性，避免用户误以为“添加项目”只是切换现有项目，并把 UI 原型审批作为未来界面变更的稳定流程要求。

## 范围内

1. 项目文件夹选择器：选择文件夹后走项目注册 API；若注册为新项目则加入并选中新项目；若 API 返回已存在项目，不应静默切换，需提示用户已存在，可从列表手动选择。
2. Studio 流程门禁：架构师 prompt、默认 workflow 指令、Studio 运行时提示、检查清单中声明 UI 变更必须先由 UI 设计员产出 HTML 原型并获得用户审批。
3. Tab 标题：优先显示当前 Project Registry 上下文的 `项目名(空间名)`；路径字符串不完全一致但 projectId/spaceId 匹配时仍使用项目标题。
4. 模型搜索：聊天与设置中的共享 `ModelSelect` 能用 provider id 和 provider display name 搜索。

## 范围外

- 不新增复杂项目导入向导或批量导入。
- 不实现真实可执行的 UI prototype 渲染器；本次只强化 Studio 流程门禁与 artifact 要求。
- 不重构模型配置弹窗的 provider 管理搜索。
- 不修改 pi SDK/provider 内部模型注册机制。

## 需求与验收标准

### R1 项目文件夹选择器添加语义

- Given 用户在左侧项目下拉点击 “Choose project folder…” 并选择未登记目录，When 选择成功，Then 调用 `POST /api/projects` 注册项目、刷新/插入项目列表、选中新项目主空间。
- Given 选择的是已登记目录或 canonical pathKey 重复目录，Then 不改变当前选中项目/会话，显示“项目已存在，可在列表中选择”的提示。
- 手动 “Add project path…” 与文件夹选择器共享注册/重复处理语义。

### R2 Studio UI 原型门禁

- 架构师默认说明明确：页面变更、前端功能新增、交互变化、审批体验变化必须指派 UI 设计员。
- UI 设计员必须基于现有项目产出 HTML 格式原型，`ui.md` 仅可作为承载/说明，不能用纯 Markdown 替代 HTML 原型。
- feature-dev/bugfix 默认流程在 planning 指令中声明条件门禁；ui-change 流程将 `ui.md` 作为审批前必需 artifact。
- 检查员默认说明包含“UI 变更未提供 HTML 原型/用户审批记录”为阻塞项。

### R3 Tab 标题规则

- 有 Project Registry 上下文时，Tab 标题稳定为 `projectName(spaceName)`。
- selected session cwd 与 project space cwd 因 trailing slash、display/real path 或 session/project linkage 差异不完全相等时，只要 `projectId/spaceId` 匹配，仍使用项目标题。
- 无项目上下文时才使用 `formatWorkspaceTitle(cwd, git)`；无 cwd 时使用 `WORKSPACE_TITLE_FALLBACK`。

### R4 模型搜索 provider 名称

- 用户输入 provider id（如 `openai-codex`）或 provider display name（如展示名/中文名）都能过滤到对应模型。
- 聊天输入和 Settings Studio 模型策略下拉行为一致。
- 选择值仍保持 `provider/modelId`，不改变后端 set_model 契约。

## 未决问题

- 对“已存在项目”是否需要提供一键“切换到该项目”CTA？推荐先只提示，避免继续混淆“添加”和“切换”。
- 是否要为旧项目本地 `.ypi/workflows/*.json` 自动迁移？推荐本仓库直接更新；默认初始化逻辑后续只影响新项目。
