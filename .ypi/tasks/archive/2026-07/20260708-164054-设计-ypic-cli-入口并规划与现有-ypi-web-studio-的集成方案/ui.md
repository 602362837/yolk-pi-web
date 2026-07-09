# ui

## UI 原型门禁结论

本任务建议 **不触发 Web UI HTML 原型门禁**，理由：

- 规划范围不改变现有浏览器页面、组件、审批 Tab、Settings 表单或用户可见 Web 信息结构。
- `ypic` 的目标是新增终端 chat 入口，MVP 采用纯文本 REPL + 流式输出 + 少量 slash/控制命令，不设计新的浏览器页面，也不把 Studio 工作台搬入终端。
- 配置、Studio artifact 预览、plan approval 详情继续跳转到现有 Web 页面；Web 页面交互不变。

若后续产品决定为 `ypic` 增加富 TUI（例如 curses 风格多面板、任务列表、artifact 预览、审批交互表单），或改变现有 Web 的审批/设置/Studio 页面，则必须重新触发 UI 原型门禁并由 UI 设计员产出 HTML 原型。

## CLI 交互要点（文本规格，非 HTML 原型）

### 启动

```text
$ ypic
YPI CLI chat · cwd: /path/to/project
Using local ypi server: http://127.0.0.1:30141
Type /help for commands, /config to open Web settings, /quit to exit.

> 
```

### 普通消息

```text
> explain this repo
assistant ▸ 正在读取项目结构…
tool read AGENTS.md ✓
assistant ▸ 这个仓库是 yolk pi web，本地 WebChat 工作台…
```

### Studio 轻入口

```text
> /studio-feature add ypic CLI
studio ▸ task created: 20260708-...  status: planning
studio ▸ plan review: .ypi/tasks/.../plan-review.md
studio ▸ open Web for artifacts/approval: /open
```

### 配置跳转

```text
> /config
Opened http://127.0.0.1:30141 in your browser.
Use Settings for models, auth, Studio member policy, terminal, usage, and editor configuration.
```

### 退出与后台任务

```text
> /quit
Studio still has running child tasks for this session.
Keeping local ypi server alive: http://127.0.0.1:30141
```

## 不在 CLI 中实现的 UI

- 模型配置表单、OAuth 登录流程、账号管理。
- YPI Studio Members/Workflows/Tasks 多 Tab 面板。
- artifact Markdown/HTML preview sandbox。
- Project Registry 树、WorkTree 管理、文件浏览器、Web Terminal。
