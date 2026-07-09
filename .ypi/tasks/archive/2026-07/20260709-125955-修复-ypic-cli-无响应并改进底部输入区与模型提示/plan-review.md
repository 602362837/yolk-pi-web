# plan review

## 结论

本计划建议修复 `ypic` 的实际可用性问题，并补齐终端模型选择与底部输入体验。由于任务包含明显用户可见交互变化，**必须先完成 UI HTML 原型与审批**，再进入实现。

## 相关产物

- [brief.md](brief.md)
- [prd.md](prd.md)
- [ui.md](ui.md)
- [design.md](design.md)
- [implement.md](implement.md)
- [checks.md](checks.md)

## PRD 摘要

目标：让 `ypic` CLI 可用、可诊断、可切换模型，并具备稳定的终端输入体验。

范围内：

- 启动提示增强。
- `/model` 模型和 thinking 选择。
- 普通输入无响应修复：发送状态、SSE connected、错误可见。
- TTY 底部固定输入区和模型状态显示。
- plain fallback、测试和文档。

范围外：

- 不自启 server。
- 不复制完整 Web Settings/Studio 面板。
- 不改变 JSONL/session store/Studio approval gate。

## UI 摘要

已判定触发 UI 原型门禁。UI 设计员已在此任务目录下产出了自包含的 HTML 原型：
- [ypic-cli-prototype.html](ypic-cli-prototype.html)

原型覆盖了启动提示、空闲输入区、发送等待/运行状态、`/model` 选择状态、网络与连接错误状态，以及非 TTY fallback 说明。

当前状态：HTML 原型已产出，等待用户/主会话审批。

## Design 摘要

保留 `ypic` 作为 CommonJS HTTP/SSE 轻客户端，不 import 项目 TS，不嵌入独立 Pi SDK。主要改动集中在 `bin/ypic.js`：

- 加载 `/api/models` 与 live agent state。
- 显式处理 `/model`，调用现有 `set_model` / `set_thinking_level`。
- 让 SSE 连接有 connected gate 和错误状态。
- 发送 prompt 前立即显示 sending/waiting 状态。
- 抽象 TTY `TerminalFrame` 与 `PlainFrame` fallback。

根因范围：

- `/model` 无响应：当前无 CLI handler，未知 slash 被当作 prompt 透传。
- 普通输入无响应：当前缺少可见 pending/error 状态，且 SSE connect 是 fire-and-forget，早期消息存在竞态/静默等待风险；仍需端到端 debug 确认是否叠加模型/auth/preflight 问题。

## Implement 摘要

建议子任务顺序：

1. UI 原型与审批。
2. 端到端诊断无响应路径。
3. `/model` 命令实现。
4. SSE/send 可靠性与状态反馈。
5. TTY 底部输入区与状态栏。
6. 文档、测试、验证。

详细机器可读计划见 [implement.md](implement.md)。

## Checks 摘要

最低自动验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:ypic-cli
node bin/ypic.js --help
```

关键手工验收：

- `/model current/list/切换` 可用。
- 普通中文 prompt 不再静默。
- TTY 底栏与模型状态正确。
- plain fallback 正常。
- `/studio-*` 与 approval gate 不回归。

## S1 门禁核查记录 (implementer, 2026-07-09)

| 核查项 | 状态 | 说明 |
| --- | --- | --- |
| `ui.md` 引用 task-local `.html` 原型 | ✅ 通过 | `ui.md` 以相对链接引用 `ypic-cli-prototype.html`，并逐项描述了 6 个设计状态 |
| `ypic-cli-prototype.html` 为自包含文件 | ✅ 通过 | 736 行，单文件，含 HTML/CSS/JS，`</html>` 与 `</script>` 完整闭合 |
| 启动欢迎状态 (Startup) | ✅ 通过 | 含 banner、cwd、session、model/thinking、slash commands、web 入口 |
| 空闲输入状态 (Idle) | ✅ 通过 | 底部固定输入栏、分隔线、右侧模型/thinking 状态灯 |
| 运行/流式状态 (Running) | ✅ 通过 | sending→SSE connected 时序、tool call 渲染、thinking 计时、running/steer 状态 |
| /model 选择状态 (Model Select) | ✅ 通过 | 三步交互：provider→model→thinking，含直接命令语法 |
| 诊断/错误状态 (Error) | ✅ 通过 | 连接失败排查指南、端口/离线诊断、重试提示 |
| 非 TTY 降级 (Plain Fallback) | ✅ 通过 | `YPIC_PLAIN=1`、readline REPL、`[YPIC:info]` 前缀、无 ANSI 污染 |
| plan-review.md 记录审批状态 | ✅ 通过 | 用户已于 2026-07-09T05:00 UTC 在 chat 中明确批准，服务端已记录 approvalGrant |
| 主会话明确批准进入实现 | ✅ 通过 | 用户回复 "批准，进入实现"，主会话随后发出 "确认，开始实现"，已成功转换到 implementing |

**S1 门禁结论：✅ 通过。原型侧已就绪，用户已于 2026-07-09T05:00 UTC 在 chat 中明确批准。实现阶段已启动并完成。**

## 审批请求

UI 原型已产出并经实现员核查通过（6 个交互状态均覆盖）。请主会话审阅任务目录下的 `ui.md` 与 [ypic-cli-prototype.html](ypic-cli-prototype.html)，并在用户审批通过后，将此任务推入实现阶段。
