# prd

## 目标与背景

`ypic` 已作为轻量终端 chat 入口接入 ypi Web server，但当前交互还停留在普通 `readline` REPL：启动提示弱、输入区不稳定、模型选择缺失，并且用户已遇到 `/model` 与普通消息看似无响应的问题。目标是在不破坏 `ypic` 复用 Web API 架构的前提下，让 CLI 达到可用、可理解、可切换模型的最低稳定体验。

## 范围内

1. 修复 `ypic` CLI 的可用性问题：普通输入必须能可靠发送、可见等待状态、可见错误。
2. 实现 `/model` CLI 命令：支持查看当前模型、选择模型、选择 thinking level，并通过现有 `/api/agent/[id]` 的 `set_model` / `set_thinking_level` 生效。
3. 改进终端输入体验：TTY 下底部固定输入区、与输出区域分隔、右侧/状态栏显示当前生效模型与 thinking；非 TTY/不支持 ANSI 时保持 plain readline fallback。
4. 增强启动提示：包含 `ypic` 自身身份、cwd、server、session、模型、核心命令、Web 配置入口、Studio/approval 轻提示、与 Web 端关键能力入口一致的提示。
5. 增加诊断与验证：覆盖 `/model`、普通 prompt、SSE connected、send pending、preflight/error、TTY fallback 的测试/手工验收。

## 范围外

- 不让 `ypic` 自启 server；仍要求先运行 `ypi`/Web server。
- 不新增独立 session store、不改变 JSONL 格式、不绕过 Studio approval gate。
- 不在 CLI 中复制完整 Web Settings、Project Sidebar、File Explorer、Studio artifact HTML preview。
- 不直接 import 项目 TypeScript 到 `bin/ypic.js`；仍保持发布包可直接执行。

## 需求与验收标准

| 编号 | 需求 | 验收标准 |
| --- | --- | --- |
| R1 | 启动提示明确 | 启动后展示 `ypic` 身份、cwd、server URL/version、session id、当前模型/thinking、`/help`、`/config`、`/oweb`、`/model`、退出/中断说明；模型缺失时提示 `/config`。 |
| R2 | 普通输入可靠 | TTY 下输入任意文本后立即显示“已发送/Waiting for model…”状态；随后 SSE 输出 assistant/tool 事件；失败时显示 HTTP/preflight/auth/model 错误和下一步。 |
| R3 | SSE 连接可靠 | 首条消息前等待或确认 SSE connected；超时降级为可见警告但不静默；SSE error/closed 时可见并在运行中重连或提示。 |
| R4 | `/model` 可用 | `/model` 不再作为普通 prompt；可列出/search 模型，选择 provider/model，选择 thinking level；成功后状态栏更新；失败显示明确错误。 |
| R5 | 底部输入区 | 支持 ANSI TTY 时输入区固定在底部，与历史输出用分隔线隔开；右侧或状态栏显示当前模型/thinking/agent 状态；窗口 resize 后可重绘。 |
| R6 | fallback 兼容 | 非 TTY、CI、`NO_COLOR`/不支持 ANSI 或管道输入时保持现有简单输出，不使用光标控制导致日志污染。 |
| R7 | Web/Studio 边界 | `/config`/`/oweb` 仍打开 Web；`/studio-*` 仍透传给现有 extension；approval 只提示不自动批准。 |

## 未决问题 / 决策建议

1. “Web 端已有关键提示”的精确口径需主会话确认。建议首版纳入：模型/auth 配置入口、slash commands、Studio approval、Browser Share/附件能力需回 Web、Steer/Follow-up/Ctrl-C 行为。
2. `/model` 交互复杂度需确认。建议首版支持“无参数交互选择 + `/model provider/model [thinking]` 直接设置”，不做完整富搜索面板。
3. 固定底部输入是否必须覆盖所有终端。建议只对 `process.stdout.isTTY && !NO_COLOR` 启用，其他场景 fallback。
