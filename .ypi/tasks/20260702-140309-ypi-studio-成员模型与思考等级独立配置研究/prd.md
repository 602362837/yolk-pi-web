# PRD — YPI Studio 成员模型与思考等级独立配置

## 目标与背景

当前 YPI Studio 的 `ypi_studio_subagent` 已支持在工具入参里临时传入 `model` / `thinking`，但默认四类成员没有独立的持久配置；主 Chat 的 Studio 子成员工具调用展示也主要从入参或最终结果读取元数据，运行中不一定能看到“实际使用”的模型和思考等级。同时，在启用了项目本地 Trellis 扩展的工作区，YPI Studio 成员子进程会继续加载 Trellis 上下文，干扰只按 YPI Studio 流程执行。

本任务设计一条可实现路径，使 architect、ui-designer、implementer、checker 能在 Web 设置中分别配置运行模型与 thinking 等级，并让主 Chat 的 `ypi_studio_subagent` 调用位置展示解析后的实际运行策略，同时隔离 Trellis 对 YPI Studio 成员流程的影响。

## 范围内

- 在 `pi-web.json` 增加 YPI Studio 本地运行配置，支持默认策略与四个默认成员的独立策略。
- 后端在 `ypi_studio_subagent` 执行前解析有效策略：显式工具入参优先，其次成员配置，再到默认策略 / 主会话 / Pi 默认。
- 子成员进程使用解析后的模型与 thinking 启动，并把解析结果写入实时 progress、最终 tool result details、`.ypi/tasks/*/task.json` subagent run 记录和可选 transcript 元数据。
- 主 Chat 的 `YpiStudioSubagentTranscript` 在折叠头和展开元信息中展示实际 model / thinking，而不是只展示入参默认值。
- Settings UI 增加 YPI Studio 成员策略配置入口，复用现有 `ModelPolicySelect` / `ThinkingSelect` 交互。
- 子成员运行时隔离 Trellis 扩展注入，避免成员进程出现 Trellis workflow-state / SessionStart 约束。

## 范围外

- 不改变 YPI Studio 工作流状态机、任务产物格式或成员职责定义。
- 不实现动态路由器、难度自动分类或按任务类型自动选择模型；本次只做显式成员策略。
- 不迁移 `.ypi/agents/*.md` 为模型配置文件；成员 Markdown 继续负责角色定义。
- 不改变普通 Trellis 面板、Trellis 子代理或非 YPI Studio 的 `subagent` / `trellis_subagent` 行为。
- 不在本设计阶段修改生产代码。

## 需求与验收标准

1. **成员独立配置**
   - 用户可为 architect、ui-designer、implementer、checker 分别配置模型策略和 thinking。
   - 支持模型策略：跟随主会话、Pi 默认、指定模型、本层不指定。
   - 支持 thinking：跟随主会话、off、minimal、low、medium、high、xhigh。
   - 未配置时保持兼容：默认跟随主会话模型和 thinking；主会话不可解析时退回 Pi 默认。

2. **运行策略解析与传递**
   - `ypi_studio_subagent` 明确传入 `model` / `thinking` 时覆盖配置。
   - 后端记录并返回实际 `model`、`thinking`、`modelSource`、`thinkingSource`。
   - 子进程启动参数使用分离形式 `--model <provider/modelId>` 与 `--thinking <level>`，避免把 thinking 拼进包含冒号的模型 ID。

3. **主 Chat 展示**
   - 折叠头展示 member、状态、耗时、实际 model / thinking 的短标签。
   - 展开元信息展示 Model、Thinking、来源信息；运行中、完成后、从历史 session 加载时均能显示。
   - 若仅知道 Pi 默认或无法解析，展示 `Pi default` / `default`，不误报为主会话模型。

4. **Trellis 隔离**
   - YPI Studio 成员子进程默认设置 Trellis 子进程禁用标志，使项目本地 Trellis 扩展早退。
   - 成员 prompt 中明确声明忽略 Trellis 流程和 Trellis task 约束，除非父会话显式要求。
   - 保留主会话中用户主动使用 Trellis 的能力；本任务只隔离 YPI Studio 成员子进程。

## 未决问题

- 默认四成员是否要预设不同 thinking（例如 architect/checker=high、ui-designer=medium、implementer=high），还是全部保持 followMain/inherit 以最大兼容？推荐第一版保持兼容，交给用户在 Settings 中改。
- 是否允许 `.ypi/agents/*.md` frontmatter 作为项目级默认策略？推荐不做 MVP，避免把本机模型 ID 写进项目文件。
