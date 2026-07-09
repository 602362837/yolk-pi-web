# 设计 ypic CLI 入口并规划与现有 ypi/web/Studio 的集成方案

- Task: 20260708-164054-设计-ypic-cli-入口并规划与现有-ypi-web-studio-的集成方案
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260708-164054-设计-ypic-cli-入口并规划与现有-ypi-web-studio-的集成方案
- Archived at: 2026-07-09T02:20:51.777Z
- Tags: feature-dev, cli, ypic, studio, web-integration

## Summary
完成了 ypic CLI 入口设计与实现，并验证其复用现有 ypi Web server/API 的轻量架构可行。关键结论：保留 ypi 作为 Web 入口，新增 ypic 作为终端 chat 入口；ypic 不自启 server，仅通过 GET /api/cli/health 识别可复用的 yolk-pi-web 服务；聊天复用 /api/projects、/api/agent/draft、/api/agent/[id]、/api/agent/[id]/events，不引入新 session 格式。当前目录即 workspace；若 cwd 未注册为项目，则通过现有 Project Registry API 自动建立/注册 project/space，上下文按 canonical path/pathKey 去重。CLI 只做 chat 与轻控制，复杂配置通过 /config /open 打开 Web。Studio 在 CLI 中只做轻量状态摘要与审批提示，不复制完整工作台，也不绕过 approval gate。新增了 --resume <sessionId>、/oweb、/quit 打印 resume 命令与固定 Web session 链接。实现层面新增 app/api/cli/health/route.ts、bin/ypic.js、bin/server-runner.js，并保持 ypi 兼容。已通过 lint、tsc、help、纯函数 smoke tests；真实端到端验证确认 health、project auto-registration、agent API 与 SSE 流可用。

## Reusable knowledge
# Summary

完成 `ypic` CLI 入口设计、实现与验证。`ypi` 保持为 Web 工作台入口，`ypic` 作为轻量终端 chat 入口，复用现有 ypi Web server/API，而不是单独维护一套 SDK runtime。

# Reusable knowledge

- **入口分工**：`ypi` 继续负责启动/进入 Web；`ypic` 负责当前目录 chat。两者同包发布，`bin/pi-web.js` 为 Web 入口，`bin/ypic.js` 为 CLI 入口。
- **server 策略**：`ypic` **不自启 server**。启动时仅调用 `GET /api/cli/health`；若不是 `yolk-pi-web` 或不可达，只打印手动启动指引。
- **最小 CLI 契约**：`ypic [message]`、`--port`、`--hostname`、`--continue`、`--resume <sessionId>`、`--help`；环境变量支持 `PI_WEB_PORT/PORT`、`PI_WEB_HOST/HOSTNAME`。
- **session / project 绑定**：当前目录就是 workspace。若 cwd 尚未加入项目，CLI 先复用 `GET/POST /api/projects` 自动建立/注册 project/space；去重依赖 canonical path + `pathKey`，避免重复项目。
- **会话创建流**：推荐 `resolveProjectContext -> POST /api/agent/draft -> 连接 GET /api/agent/:id/events -> POST /api/agent/:id {type:"prompt"}`，避免首条消息早期 SSE 事件丢失。
- **CLI 能力边界**：只做 chat、SSE 渲染、少量命令；复杂配置通过 `/config` 或 `/open` 打开 Web。新增 `/oweb` 直接打开当前 session 固定链接 `/?session=<id>`。
- **Studio in CLI**：`/studio-*` 原样透传给现有扩展；CLI 只显示 task/run/member/status 等紧凑摘要，并在 `awaiting_approval` 时提示 `plan-review.md` 路径与 Web 链接；不复制 Web Studio 面板，不写 approval grant，不绕过审批门禁。
- **退出体验**：`/quit` 退出时打印 `ypic --resume <sessionId>` 命令和固定 Web session 链接，便于恢复同一会话。
- **发布/实现约束**：`bin/ypic.js`、`bin/server-runner.js` 必须保持 CommonJS，只依赖 Node built-ins，不直接 import 项目 TypeScript，保证 npm 包可直接执行。
- **验证要点**：最少覆盖 `npm run lint`、`tsc --noEmit`、`node bin/ypic.js --help`、`node scripts/test-ypic-cli.mjs`；真实 smoke 重点验证 health、project auto-registration、agent API、SSE 流、`/oweb` 与 `/quit` 恢复提示。

# Source artifacts

- `.ypi/tasks/20260708-164054-设计-ypic-cli-入口并规划与现有-ypi-web-studio-的集成方案/plan-review.md`
- `.ypi/tasks/20260708-164054-设计-ypic-cli-入口并规划与现有-ypi-web-studio-的集成方案/prd.md`
- `.ypi/tasks/20260708-164054-设计-ypic-cli-入口并规划与现有-ypi-web-studio-的集成方案/design.md`
- `.ypi/tasks/20260708-164054-设计-ypic-cli-入口并规划与现有-ypi-web-studio-的集成方案/implement.md`
- `.ypi/tasks/20260708-164054-设计-ypic-cli-入口并规划与现有-ypi-web-studio-的集成方案/checks.md`
- `.ypi/tasks/20260708-164054-设计-ypic-cli-入口并规划与现有-ypi-web-studio-的集成方案/review.md`
- `.ypi/tasks/20260708-164054-设计-ypic-cli-入口并规划与现有-ypi-web-studio-的集成方案/handoff.md`
- `.ypi/tasks/20260708-164054-设计-ypic-cli-入口并规划与现有-ypi-web-studio-的集成方案/ui.md`

## Source artifacts
- handoff.md
- review.md
- checks.md
- design.md
- implement.md
- prd.md
- brief.md
- ui.md
- plan-review.md
