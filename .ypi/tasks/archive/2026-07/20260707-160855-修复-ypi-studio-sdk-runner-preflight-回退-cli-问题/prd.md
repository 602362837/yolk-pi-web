# PRD

## 目标

1. Studio subagent 默认 `auto` 模式应优先稳定使用 SDK child runner。
2. SDK child runner 必须创建可持久化的 child JSONL session，并写入 `studioChild` header。
3. 用户仅运行本项目、未安装独立 `pi` CLI 时，Studio subagent 仍可工作。
4. SDK preflight/fallback/失败原因必须在 task run 中可见，便于诊断。

## 非目标

- 不重构 Studio 工作流状态机。
- 不改变 CLI runner 作为显式 `studio.subagents.runner=cli` 回滚路径的能力。
- 不从 CLI transcript sidecar 估算 usage。

## 验收

- `studio.subagents.runner=auto` 的新 Studio subagent run 显示 `runner=sdk`，包含 `childSessionId` / `childSessionFile`。
- `~/.pi/agent/sessions/**/<child>.jsonl` header 包含 `studioChild.kind="ypi-studio-child-session"` 与正确 parent/task/run/member 信息。
- `GET /api/usage?sessionId=<parent>` 可看到 `studioChildSessionCount > 0`（真实 run 有 usage 后）。
- 强制 `runner=sdk` 时 preflight 失败必须直接持久化 failed，并包含真实错误，不再变成 `runtime_lost`。
- `auto` fallback 若发生，task run warnings/summary 可看到 SDK preflight 错误。
