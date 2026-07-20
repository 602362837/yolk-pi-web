# brief — Studio Context Integrity（SCI）

## 问题

主会话 Chat 的用户气泡会展示大段 Studio 注入内容：`<ypi-studio-state>`、Existing Studio tasks、`<ypi-studio-knowledge>` 等。根因是 `lib/ypi-studio-extension.ts` 在 `pi.on("input")` 里对用户文本做 `transform`，把 `buildStudioState(...)` 拼进 user message；同轮 `before_agent_start` 又再注入一次，形成**双注入**，并污染 JSONL / 标题种子 / Copy / Edit from here。

## 目标（用户已确认）

交付 **Studio Context Integrity（SCI）** 两层方案：

| Layer | 目标 |
| --- | --- |
| **L0 Chat 展示** | 渲染时剥离已知 Studio 注入标签；气泡只显示用户原文；有注入时显示 compact `Studio · <status>` tag；Copy/Edit 默认干净文本；覆盖历史脏 JSONL（不迁移） |
| **L1 注入收敛** | 去掉 input transform；input 只保留审批副作用；`before_agent_start` 成为主会话状态/knowledge **唯一**注入点，并用 `event.prompt` 保持 knowledge 相关性不弱于现网 |
| **L2** | 非本交付核心：no_task 轻量注入、token 优化、display:false custom 等可后续 |

## 不可回退

- 审批同轮 grant（`recordYpiStudioUserApproval` 仍在 input）
- 状态机编排与 tool 门禁
- 主会话 knowledge 相关性（query 对齐用户本轮 prompt）
- 子代理 `buildMemberPrompt` / knowledge（child 不挂主 extension）
- widget 批准 / continuation / steer / follow-up

## 源码证据（已核实）

1. `lib/ypi-studio-extension.ts` `pi.on("input")`：`return { action: "transform", text: [ev.text, injection].join("\n\n") }`，且先 `recordYpiStudioUserApproval`
2. 同文件 `before_agent_start`：`buildStudioState(root, key)` **无 query**，并叠加一次性 `startupContext`
3. `buildMemberPrompt` 独立拼装 task/docs/knowledge，不依赖 user transform
4. Pi SDK `docs/extensions.md`：`before_agent_start` 提供 `event.prompt`；`input` 可 `continue` / `transform` / `handled`
5. `components/MessageView.tsx` `UserMessageView` 直接渲染完整 `content`；Copy/Edit 使用同一全文
6. `hooks/useAgentSession.ts` 乐观消息与 `sessionTitleSeedFromUserMessage(message)` 使用客户端原文（新消息标题在 L1 后自然干净；历史脏 firstMessage 需 L0/title 侧 strip）

## 约束

- UI 门禁：L0 改变用户消息展示结构 → 需要 HTML 原型 + 用户审批后再实现
- 本 delegated 环境**无** `ypi_studio_subagent` / `ypi_studio_task` 工具；架构师已直接产出规划与 HTML 原型，正式 ui-designer 派发与 task transition 需主会话补齐
- 不实现代码；停在 awaiting_approval

## 成功标准（摘要）

- 新 user JSONL 无 Studio 注入块
- 历史脏消息 UI 只显示用户原文 + compact tag
- LLM 每轮仍见最新 state + 相关 knowledge + 编排规则
- checks 全覆盖（单元 / extension / 回归 / lint+tsc / 人工矩阵）
