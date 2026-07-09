# plan review

## 审批请求

请审阅本计划，确认是否按该方案进入实现阶段。确认前不应实现代码。

## 相关产物

- [brief.md](brief.md)
- [prd.md](prd.md)
- [ui.md](ui.md)
- [design.md](design.md)
- [implement.md](implement.md)
- [checks.md](checks.md)

## PRD 摘要

目标：新增 `ypic` CLI 入口，让用户在当前目录以轻量终端 chat 方式使用 ypi/pi agent；保留 `ypi` 作为现有 Web 工作台入口。

范围内：

- 新增 npm bin `ypic`。
- 当前 cwd 绑定 session/workspace。
- 复用或拉起现有 ypi Web server。
- CLI 提供 chat loop、流式输出、少量控制命令、配置跳转。
- YPI Studio 通过 slash command 轻量控制，artifact/配置/完整任务详情仍在 Web。

范围外：

- 不改变 `ypi` 定位和现有行为。
- 不在终端重做 Web 工作台、Project Sidebar、Settings、Studio Panel、artifact preview。
- 不新增独立 session 格式。

## UI 结论

本任务不触发 Web UI HTML 原型门禁：不改变现有浏览器页面/组件/审批 Tab/设置交互，MVP 是纯文本 CLI chat。若后续要做富 TUI 或 Web deep link 自动打开设置/审批弹窗，需要重新触发 UI 门禁。详见 [ui.md](ui.md)。

## Design 摘要

推荐架构：`ypic` 作为本地终端控制器，背后复用/拉起同包 ypi Web server，并通过现有 HTTP/SSE API 操作 AgentSession。

关键设计：

1. `ypi` 保持 Web 启动入口；新增 `ypic` additive bin。
2. 新增极小健康检查 `GET /api/cli/health`，用于识别可复用 ypi server。
3. `ypic` 使用 `POST /api/agent/draft` + `GET /api/agent/:id/events` + `POST /api/agent/:id`，避免复制 SDK runtime。
4. Studio 由现有 `lib/rpc-manager.ts` 注入的 extension 处理；CLI 只展示紧凑状态和 plan-review 提示。
5. MVP 不自动注册 Project Registry，避免污染项目列表；后续可做显式 `--register-project`。

详见 [design.md](design.md)。

## Implementation Plan 摘要

计划拆为 5 个子任务：

1. `cli-contract-health`：定义 CLI 契约并新增 `/api/cli/health`。
2. `server-runner-refactor`：提取 `ypi`/`ypic` 共用 server 启动器，保持 `ypi` 兼容。
3. `ypic-chat-client`：实现 `ypic` chat loop、HTTP 命令、SSE 渲染。
4. `studio-light-controller`：实现 Studio 轻入口摘要、plan-review 提示、后台任务退出保护。
5. `docs-tests-release-check`：更新文档、补 smoke 测试/验证。

机器可读 implementationPlan 见 [implement.md](implement.md)。

## Checks 摘要

实现后最低验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
node bin/ypic.js --help
```

重点手工验收：

- `ypi` 启动与自动开浏览器不回归。
- `ypic` 可复用/拉起 server 并在当前 cwd 创建 session。
- `/config` 打开 Web。
- `/studio-feature` 能创建/推进 Studio task，CLI 只显示轻量状态。
- awaiting approval 仍由用户明确聊天输入触发现有 approval gate。

详见 [checks.md](checks.md)。

## 需要主会话 / 用户确认的决策

1. 是否接受 `ypic` 依赖/复用 ypi Web server API，而不是直接嵌入独立 SDK runtime？（推荐接受）
2. MVP 是否默认不自动注册 Project Registry？（推荐不自动注册）
3. `ypic` 不允许自启 server；若未检测到 server，则提示用户先手动启动 `ypi`/Web server。（已确认）
4. 是否接受首版 `/config` 只打开 Web 根页，不做 Web deep link 自动开设置弹窗？（已确认接受，以避免扩大 UI 范围）
