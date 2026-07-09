# prd

## 目标与背景

`yolk pi web` 当前以 `ypi` 命令启动本地 WebChat 工作台。新增 `ypic` 的目标是提供一个更贴近常见 AI CLI 的终端聊天入口：用户在任意项目目录执行 `ypic` 后，即以该目录为 workspace 与 agent 对话；当需要模型、账号、Studio 成员策略、Web Terminal 等复杂设置时，CLI 引导用户打开现有 Web 页面完成配置。

核心产品原则：`ypic` 是轻入口和控制器，不是新的完整终端工作台；能力复用现有 ypi Web server/API，降低维护面并保持 Studio 行为一致。

## 范围内

- 新增 npm bin：`ypic`。
- `ypic` 默认绑定当前目录 `process.cwd()` 创建/使用 chat session。
- `ypic` 可在本地检测/复用已运行的 ypi Web server；未运行时不自启 server，而是给出明确提示，引导用户先手动启动 Web server。
- 提供终端 chat 循环：输入消息、流式展示 assistant 文本、展示工具/Studio 进度摘要、支持 abort/quit/config/open 等少量 CLI 内命令。
- 普通 slash commands 直接作为聊天输入发送给 AgentSession，包括 `/studio-feature`、`/studio-continue`、`/studio-check` 等现有 Studio 命令。
- 配置类操作只打开浏览器到 ypi Web 页面并给出提示，不在 CLI 中实现复杂配置表单。
- YPI Studio 只做轻量控制：发起/继续/审批对话、提示 `plan-review.md` 和 Web URL、显示子代理运行状态；任务详情、artifact 预览、HTML 原型预览、成员模型配置仍在 Web 完成。
- 更新 README、deployment/module docs，说明 `ypi` 与 `ypic` 的定位差异。

## 范围外

- 不改变 `ypi` 命令现有默认行为。
- 不在 CLI 中重做 Project Sidebar、File Explorer、Settings、ModelsConfig、YpiStudioPanel、Browser Share UI。
- 不在 CLI 中实现独立模型/账号/Studio 成员配置编辑器。
- 不新增独立会话存储格式；继续使用 pi JSONL 与现有 `~/.pi/agent/` 数据目录。
- 不把完整 Studio plan approval/Artifacts Tabs 搬进终端；终端只显示路径/摘要并可打开 Web。
- 不在本轮规划阶段实现代码。

## 需求与验收标准

### R1. CLI 入口与兼容性

- 需求：包安装后同时提供 `ypi` 与 `ypic`；`ypi` 行为保持兼容。
- 验收：`package.json` `bin` 包含两个入口；`ypi --port ...`、`ypi --hostname ...`、proxy 参数行为不回归；`ypic --help` 可显示 CLI 用法。

### R2. 当前目录会话绑定

- 需求：在项目目录执行 `ypic`，首条用户消息创建 cwd 为当前目录的 session；后续消息进入同一 session。
- 验收：生成的 JSONL header `cwd` 为规范化当前目录；Web 打开该 session 时内容一致；退出再启动不会破坏旧 session。

### R3. 复用/拉起 ypi Web server

- 需求：`ypic` 优先复用同端口已运行 server；无 server 时拉起内置 Next server，默认不自动打开浏览器。
- 验收：无 server 时 `ypic` 能完成聊天；已有 `ypi` server 时不会重复启动；端口冲突且不是目标 server 时给出可操作错误。

### R4. Chat-only 终端体验

- 需求：CLI 只提供 chat 内操作和少量控制命令。
- 验收：支持普通消息、流式 assistant 文本、工具开始/结束摘要、Ctrl-C abort/退出策略、`/quit`、`/config` 或等价命令打开 Web；不暴露复杂配置表单。

### R5. YPI Studio 轻入口

- 需求：CLI 可通过现有 Studio slash commands 驱动工作流，但不复制 Web Studio 面板。
- 验收：`/studio-feature <goal>` 可创建/推进任务；CLI 显示 task id/status、plan-review 路径和“打开 Web 审批/查看 artifact”的提示；用户在 CLI 中明确回复审批文本后，仍由现有 Studio approval gate 记录授权。

### R6. 文档与发布

- 需求：README、部署文档和模块文档说明 `ypic`。
- 验收：文档包含安装后 `ypic` 用法、与 `ypi` 的差异、配置跳转原则、Studio 限制和验证命令。

## 未决问题

1. 当前目录尚未加入项目时，是否需要在 `ypic` 使用时自动注册/建立 project/space 上下文？结论：需要，避免要求用户先去 Web 手动加项目。
2. `ypic` 是否允许自启 server？结论：不允许；若 health check 失败，CLI 仅提示用户先手动运行 `ypi`/Web server。
3. 是否支持 `ypic -c/--continue` 续接当前 cwd 最近 session？推荐作为首版可选项；默认新会话更符合“当前目录启动即开始 chat”的简洁预期。
