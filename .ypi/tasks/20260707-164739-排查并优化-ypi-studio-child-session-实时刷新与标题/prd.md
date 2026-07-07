# PRD

## 目标

修复 YPI Studio SDK child session 作为只读审计视图单独打开时不会实时刷新的问题，并优化 child session 在侧边栏/标签中的标题展示，使其优先使用 Studio 任务名称。

## 用户价值

- 用户在父 Chat 编排 Studio 任务时，可以把 child session 打开到新 tab 中实时跟踪成员执行过程。
- child session 保持只读审计视图，不会误作为普通 chat 继续执行或注入 Studio 编排工具。
- child session 标题更可读，优先展示任务名称，便于在多 tab/多 child 情况下识别。

## 范围

### In scope

- 为 child session 的 `/api/agent/[id]/events` 增加只读 audit SSE 分支，跟踪 JSONL 文件变化并通知前端 reload。
- `useAgentSession` 支持 child audit SSE 事件并容错刷新消息列表。
- child session 标题 projection：优先 task title，fallback 到 run summary/taskId/session name/first message/id。
- 更新相关类型、文档与验证。

### Out of scope

- 不允许 child session 变成可交互 chat。
- 不改变 Studio task/run 的状态权威来源：仍以 `.ypi/tasks/<task>/task.json` 为准。
- 不迁移旧 session JSONL。

## 验收标准

1. 打开正在运行的 Studio SDK child session tab 时，消息会随 child JSONL 追加而刷新。
2. child session 完成后前端停止跟踪或进入 idle，不重复重连。
3. child audit SSE 不调用 `startRpcSession()`，不创建普通 `AgentSessionWrapper`，不注入 YPI Studio/Browser Share 编排工具。
4. child session 仍显示只读提示且不提供输入框。
5. child session 标题优先显示 Studio task title；任务缺失时有稳定 fallback。
6. 普通 chat 的 streaming、fork、navigate_tree、agent_end 刷新不回归。
