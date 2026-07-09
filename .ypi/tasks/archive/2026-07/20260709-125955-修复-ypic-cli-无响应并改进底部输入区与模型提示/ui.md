# ui

## UI 原型门禁结论

本任务 **触发 UI 原型门禁**。

原因：用户要求改变 `ypic` CLI 的用户可见信息结构和交互方式，包括启动提示、底部固定输入区、模型状态展示、`/model` 选择流程和无响应状态反馈。虽然这是终端 UI 而不是浏览器页面，但它仍是用户可见交互变更，必须在实现前由 UI 设计员产出 HTML 原型并交主会话/用户审批。

## 必须指派 UI 设计员

请主会话下一步指派 `ui-designer`，要求其基于现有 ypi/ypic 视觉语言产出 HTML 原型。当前架构师不直接替代 UI 设计员完成原型。

## HTML 原型交付要求

UI 设计员已在此任务目录下产出了 HTML 原型：
- 新增 task-local `.html` 原型文件: `ypic-cli-prototype.html` ([查看原型](./ypic-cli-prototype.html))

HTML 原型覆盖了以下核心设计点：
1. **启动状态 (Startup)**: 展示 ypic 的欢迎 Banner、CWD 工作空间注册信息、Session ID、默认模型与思考等级配置，并提示 `/help`、`/model`、`/config`、`/oweb` 等核心 slash 命令以及 Web 配置入口。
2. **普通空闲输入状态 (Idle)**: 展示底部固定输入区、与历史聊天区域以 ANSI 分隔线隔离，右侧展示当前模型/Thinking等级，状态灯显示灰色 (idle)。
3. **发送后等待/运行状态 (Running/Streaming)**: 发送后展示 `[YPIC] Sending...` 与 `[YPIC] SSE connected` 的即时状态，状态灯变成黄色闪烁 (busy)。在 Tool Call 执行与 AI 思考期间实时更新文本进度，输入框转换成 `(Running tool... Enter to steer)` 以支持中途输入 steer 或 /abort。
4. **/model 选择状态 (Model Select)**: 交互式步进菜单：Provider 选择 -> Model 选择 -> Thinking level 选择，最后显示成功切换。
5. **错误/诊断状态 (Error State)**: 连接异常时，输出明确的排查指南，例如 ypi 离线、端口配置错误等，并给出重试指令。
6. **非 TTY plain fallback 说明 (Fallback)**: 在非 TTY 管道或不支持 ANSI 颜色的环境中降级回退到经典的 readline 随历史滚动的普通文本 REPL 模式，日志通过 `[YPIC:info]` 输出，没有任何 ANSI 光标污染。

## 审批记录

- UI HTML 原型：已产出在任务目录下的 `ypic-cli-prototype.html`
- 用户审批：**已批准**。用户在 chat 中明确回复 "批准，进入实现"（2026-07-09T05:00 UTC 前后）。
- 主会话随后发出 "确认，开始实现"，触发 `awaiting_approval → implementing` 转换，服务端已记录 `approvalGrant`。
- 结论：UI 原型门禁已通过，实现阶段已启动并完成。
