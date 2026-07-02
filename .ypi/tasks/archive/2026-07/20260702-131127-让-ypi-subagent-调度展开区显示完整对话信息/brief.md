# brief

## 目标与背景

用户反馈：执行 YPI Studio 任务委派时，主 chat 中 `ypi_studio_subagent` 工具调用长时间只表现为“等待 subagent”；展开工具调用后主要只能看到传给子 agent 的输入，缺少子 agent 执行过程中的完整对话/进展信息，用户容易误以为卡死。

目标：让 YPI Studio subagent 调度的展开区能显示接近主 chat 体验的子 agent 对话信息，至少在运行中可见进展、完成后可回看完整输出/关键对话，降低“卡死”误解。

## 已阅读材料与现状证据

- `AGENTS.md`：YPI Studio、agent RPC/SSE、session UI 的入口分别在 `components/YpiStudioPanel.tsx`、`app/api/studio/**`、`lib/ypi-studio-*`、`lib/rpc-manager.ts`、`hooks/useAgentSession.ts`、`components/ChatWindow.tsx`、`components/ChatInput.tsx`。
- `docs/modules/frontend.md`：
  - `components/MessageView.tsx` 渲染 tool-call/tool-result 消息。
  - `hooks/useAgentSession.ts` 负责 SSE、streaming state、subagent run/routing metadata。
  - `components/SubagentPanel.tsx` 展示顶部 subagent 活动和嵌套 subagent。
- `docs/modules/api.md`：`agent/[id]/events` 是主 chat SSE；`agent/subagent-children` 当前只为 SubagentPanel 读取子 session JSONL 中的嵌套 subagent。
- `docs/modules/library.md`：
  - `lib/ypi-studio-extension.ts` 注册 `ypi_studio_subagent` 并启动 YPI Studio member child Pi 进程。
  - `lib/ypi-studio-tasks.ts` 只记录 member run summary/error 到 task JSON/event。
- 源码检查：
  - `components/MessageView.tsx` 的 `ToolCallBlock` 展开时固定先显示工具输入 JSON，若已有 paired result 才显示结果；没有针对 `ypi_studio_subagent` 的会话式渲染。
  - `lib/ypi-studio-extension.ts` 的 `runChildPi()` 通过 `spawn(pi --mode json -p --no-session)` 启动子进程，当前把 stdout/stderr 缓存在内存中，进程结束后一次性 `extractAssistantText()` 返回；`execute(..., _onUpdate?)` 未使用更新回调。
  - `ypi_studio_subagent` 的 tool result `details` 只有 `{ task, run }`，`run` 只有 `prompt`、`summary`、`model`、`thinking`、`error` 等摘要字段，没有 child session file / transcript id / streaming chunks。
  - `hooks/useAgentSession.ts` 目前只把工具名 `subagent` 和 `trellis_subagent` 识别为 SubagentRun；`ypi_studio_subagent` 不进入 SubagentPanel 的运行列表，也没有复用其 `partialOutput`/`sessionFile` 机制。

## 范围内

- 改善主 chat 中 `ypi_studio_subagent` 工具调用展开区的信息呈现。
- 运行中应显示子 agent 已开始、已等待时长、可用的实时输出/进展片段；完成后应展示完整或足够完整的子 agent对话/输出，而不只是输入 prompt。
- 明确 YPI Studio member 委派与通用 `subagent`/`trellis_subagent` 的差异，并决定是复用现有 SubagentRun/MessageView 机制，还是为 `ypi_studio_subagent` 增加专用 transcript 展示契约。
- 保持 YPI Studio task 记录可审计：必要时在 `.ypi/tasks/<task>/task.json` 或事件中保存 transcript 引用/摘要，但避免把大段对话无限写入任务元数据。
- 更新相关前端/API/library 文档（若设计确认需要新增 API、wire fields 或 UI 行为）。

## 非目标

- 不改变 YPI Studio 状态机、成员定义、工作流审批规则。
- 不实现新的成员调度策略、并发队列或模型路由。
- 不重做主 chat 的整体消息渲染体系。
- 不把所有普通工具调用都改成 chat-like 展示；本任务聚焦 YPI Studio member delegation。
- 不自动提交、推送或合并代码。

## 关键风险

1. **子进程当前无可回放 session**：`--no-session` 可能导致没有 child JSONL 可读；若要“像主 chat 一样”回放，需要确认是否改为持久化 child session，或由父进程自行记录流式 transcript。
2. **实时性与 pi CLI 输出格式**：当前只在子进程结束后解析 stdout；若 `pi --mode json` 的 stdout 是最终 JSON 而非逐条事件，实时展示可能需要调整 child 运行模式或解析协议。
3. **数据量与隐私**：完整对话可能包含系统提示、member 定义、用户上下文、文件内容。需要决定默认展示范围：完整 child chat、仅 user/assistant/tool 摘要、还是折叠的 raw transcript。
4. **UI 归属选择**：展开区属于 `MessageView` 的工具调用；顶部 `SubagentPanel` 又有 subagent 运行视图。两套入口若同时增强，需避免状态不一致。
5. **兼容已有任务记录**：历史 `ypi_studio_subagent` run 只有 summary，没有 transcript；新 UI 需对旧记录优雅降级。
6. **错误/取消路径**：子进程失败、abort、stderr 非 JSON、输出超长时，展开区仍需显示明确状态与可诊断信息，不能只回到“Waiting for output”。

## 验收标准

- 执行一次 YPI Studio member 委派时，主 chat 中 `ypi_studio_subagent` 工具调用在运行期间不再只显示输入；展开后能看到明确的运行状态和可用进展信息。
- 子 agent 完成后，展开区能展示其完整可回放内容或经设计确认的“完整对话视图”，并明显区分输入 prompt、子 agent 对话/输出、错误信息。
- 若无法取得 child transcript，UI 必须显示明确降级原因（例如“该运行未保存子会话，仅可显示最终输出”），不能让用户误判为卡死。
- 历史任务或旧 run 没有 transcript 时不报错，仍显示原 summary/result。
- 失败、取消、超长输出场景有可读状态；超长内容应折叠/截断并保留复制或查看完整内容的路径（具体交互进入设计阶段确定）。
- 修改后通过项目最低验证：`npm run lint` 与 `node_modules/.bin/tsc --noEmit`。

## 下一步建议

建议进入需求/设计阶段。原因：用户诉求明确，但实现方案依赖一个关键产品/技术决策：YPI Studio child Pi 是否应产生可持久读取的 session/transcript，以及“完整对话信息”是否包含系统/工具详情。下一阶段应产出 `prd.md`、`design.md`、`implement.md`、`checks.md`，必要时补 `ui.md` 描述工具展开区的 chat-like 布局。

## 需要主会话确认的问题

1. “完整对话信息”是否必须包括 child 的 system/developer/task context/tool calls，还是只需展示 member 可见的 user prompt、assistant 输出和工具结果摘要？
2. 是否允许取消 `--no-session` 或另行保存 child transcript，以便完成后可从文件/API 回放？
3. 展示入口优先放在主 chat 的 `ypi_studio_subagent` 工具展开区，还是也要同步增强顶部 `Subagents` 面板？
4. 对超长 transcript 的默认策略：完整内嵌、折叠分页、截断+“查看完整”、或导出/打开 session？
