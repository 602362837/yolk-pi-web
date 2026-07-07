# Summary

完成 YPI Studio child session 实时刷新与标题优化：

- child audit tab 通过只读 JSONL audit SSE 实时刷新，不会启动普通 AgentSession。
- 前端复用 chat 渲染，收到 child audit changed/end 事件后刷新子 session 视图并保持只读。
- child session 标题优先展示 Studio task title，保留 member/status/run/subtask 元信息。
- 更新相关文档并通过 lint、TypeScript 与 studio SDK runner 测试。
