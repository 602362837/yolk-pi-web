# brief

## 背景

YPI Studio 的 `ypi_studio_subagent` 会启动子 Pi 进程执行成员任务，并通过父会话工具调用等待子进程完成。若子进程中的扩展/UI 工具发出需要用户响应的交互请求（例如 `select` / `confirm` / `input` / `editor`），父会话原先只显示仍在运行，用户会误以为主 session 卡死。

## 目标

- 识别子 Pi 进程发出的阻塞型 `extension_ui_request`。
- 不让父会话无限等待子进程。
- 在父会话的 YPI Studio subagent 展开区中明确显示子成员正在等待用户输入，以及请求标题/消息/选项等信息。

## 范围内

- YPI Studio `ypi_studio_subagent` 子进程 JSON 事件解析。
- 子成员运行状态增加 `waiting_for_user`。
- 前端 transcript 展示该状态。
- 更新相关架构/模块文档。

## 范围外

- 本次不实现“父会话输入后自动回填到仍存活的子进程”的完整双向交互通道。
- 不改通用 pi-subagents npm 包行为。

## 验收标准

- 子进程发出阻塞型 extension UI request 时，父工具调用结束为 `waiting_for_user`，并显示可读问题详情。
- 非阻塞 notify/status 类 UI request 不触发等待状态。
- lint 与 TypeScript 检查通过。
