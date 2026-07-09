# implement

## 执行步骤

| 顺序 | 子任务 | 主要文件 | 串并行 |
| --- | --- | --- | --- |
| 1 | 明确 CLI 契约与健康检查 API | `app/api/cli/health/route.ts`, docs | 串行起点 |
| 2 | 提取 `ypi` server 启动公共逻辑并保持兼容 | `bin/pi-web.js`, `bin/server-runner.js` | 依赖 1 |
| 3 | 实现 `ypic` chat loop / HTTP / SSE 客户端 | `bin/ypic.js`, `package.json` | 依赖 2 |
| 4 | 补齐 Studio 轻入口状态展示与退出保护 | `bin/ypic.js` | 依赖 3 |
| 5 | 文档、测试脚本与验证 | `README.md`, `docs/*`, `scripts/*` | 收尾 |

## 需先阅读的文件

- `AGENTS.md`
- `README.md`
- `docs/architecture/overview.md`
- `docs/deployment/README.md`
- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `docs/standards/code-style.md`
- `package.json`
- `bin/pi-web.js`
- `app/api/agent/new/route.ts`
- `app/api/agent/draft/route.ts`
- `app/api/agent/[id]/route.ts`
- `app/api/agent/[id]/events/route.ts`
- `hooks/useAgentSession.ts`
- `lib/rpc-manager.ts`
- `lib/agent-session-bootstrap.ts`
- `lib/ypi-studio-extension.ts`
- `components/YpiStudioSubagentTranscript.tsx` / `components/YpiStudioWaitPanel.tsx`（仅借鉴 Studio 摘要字段，不复制 UI）

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "summary": "新增 ypic 终端 chat 入口，复用/拉起现有 ypi Web server 与 AgentSession/YPI Studio API；ypi Web 入口保持兼容。",
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "cli-contract-health",
      "title": "定义 ypic CLI 契约并增加 server 健康检查",
      "phase": "api-contract",
      "order": 10,
      "dependsOn": [],
      "files": [
        "app/api/cli/health/route.ts",
        "docs/modules/api.md",
        "docs/architecture/overview.md"
      ],
      "instructions": [
        "新增 GET /api/cli/health，返回 ok/app/version/pid/capabilities，不返回 secrets。",
        "健康检查用于 ypic 区分可复用的 ypi server 与端口冲突的其他服务。",
        "在架构/API 文档中记录 ypic 复用 Web API 的运行流和 route 用途。",
        "不要修改现有 /api/agent/* 契约；ypic 优先复用 draft/prompt/events/get_state。"
      ],
      "acceptance": [
        "GET /api/cli/health 返回稳定 JSON，HTTP 200。",
        "未启动 ypi server 时 ypic 会给出明确提示，引导用户先手动启动 server。",
        "现有 API route 行为不变。"
      ],
      "validation": [
        "curl http://127.0.0.1:30141/api/cli/health",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "读取 package version 时不要依赖不可发布路径；package.json 已在 files 中。",
        "健康检查不应泄露环境变量、token 或用户目录细节。"
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "server-runner-refactor",
      "title": "提取 ypi/ypic 共用 server 启动器并保持 ypi 兼容",
      "phase": "cli-runtime",
      "order": 20,
      "dependsOn": ["cli-contract-health"],
      "files": [
        "bin/pi-web.js",
        "bin/server-runner.js"
      ],
      "instructions": [
        "把 bin/pi-web.js 中 Next bin resolve、proxy env、spawn、Ready 检测、open browser 逻辑提取到 CommonJS helper。",
        "bin/pi-web.js 继续解析现有 port/hostname/proxy/socks-proxy/no-proxy 参数，默认 openBrowser=true，行为与当前版本一致。",
        "helper 至少支持 ready callback，供 ypi 复用；首版不要求 ypic 使用它自启 server。",
        "不要引入 shell:true 启动 Next；延续当前 process.execPath + nextBin 的跨平台策略。"
      ],
      "acceptance": [
        "ypi 默认仍在 Ready 后打开浏览器。",
        "ypi --port/--hostname/proxy 参数行为不回归。",
        "ypic 与该 helper 的耦合仅限共享参数/URL 约定，不要求自启 server。"
      ],
      "validation": [
        "node bin/pi-web.js --help 或最小 smoke 检查参数解析不崩溃（如不支持 help，记录原因）",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "bin 是 CommonJS，避免使用 ESM-only 语法。",
        "改动 pi-web.js 属于回归高风险点；保持小步提取并手工 smoke。"
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "ypic-chat-client",
      "title": "实现 ypic chat loop、HTTP 命令与 SSE 渲染",
      "phase": "cli-chat",
      "order": 30,
      "dependsOn": ["server-runner-refactor"],
      "files": [
        "bin/ypic.js",
        "package.json"
      ],
      "instructions": [
        "package.json 增加 bin.ypic。",
        "ypic 使用 process.cwd() 作为默认 cwd；支持 --port、--hostname、--continue、--help。",
        "启动时先 GET /api/cli/health；失败则打印明确提示，引导用户先手动启动 `ypi` / Web server。",
        "首条消息推荐先确保当前 cwd 已建立/注册 project/space 上下文，再 POST /api/agent/draft 创建 session，连接 /api/agent/:id/events 后 POST /api/agent/:id {type:'prompt'}，避免早期 SSE 丢失。",
        "实现 readline chat loop：普通输入发 prompt；agent running 时提供 steer/follow-up/abort 策略；/quit 退出；/config 或 /open 打开 Web 根页。",
        "实现轻量 SSE parser：解析 data 行 JSON，渲染 assistant text delta、tool start/end、agent_end、agent_error；未知事件忽略或 debug 显示。",
        "不要直接 import 项目 TS lib；bin/ypic.js 必须在发布包中可由 Node 直接执行。"
      ],
      "acceptance": [
        "npm link 或 node bin/ypic.js 能在当前目录进入聊天。",
        "生成 session 的 cwd 为启动目录。",
        "assistant 文本可流式显示；工具事件不会输出大块 raw JSON。",
        "Ctrl-C 在 running 时 abort，idle 时可退出。",
        "ypi 入口不受 ypic 影响。"
      ],
      "validation": [
        "node bin/ypic.js --help",
        "手工运行 ypic，发送一条简单消息",
        "在已有 ypi server 运行时再次运行 ypic，确认复用 server",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Node fetch streaming/SSE parsing要处理 chunk 边界和多行 data。",
        "终端渲染不能假设 ANSI 支持；颜色应可关闭或降级。",
        "如果 provider/auth 未配置，错误提示应引导 /config 打开 Web。"
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "studio-light-controller",
      "title": "补齐 YPI Studio 轻入口与状态提示",
      "phase": "studio-integration",
      "order": 40,
      "dependsOn": ["ypic-chat-client"],
      "files": [
        "bin/ypic.js"
      ],
      "instructions": [
        "将 /studio-* 输入原样作为 chat prompt 发送，依赖现有 Studio extension 处理。",
        "对 ypi_studio_task / ypi_studio_subagent / ypi_studio_wait 相关 tool events 做紧凑摘要：taskId/status/member/runId/phase/tps/currentTool/plan-review path。",
        "当工具结果或 session studio-task API 显示 awaiting_approval，提示 plan-review.md 路径和 /open；不要由 CLI 直接写 approvalGrant。",
        "退出时调用 get_state 和/或 /api/sessions/:id/studio-task，若存在 running/queued/waiting_for_user child runs，则提示用户改到 Web 继续查看；不要尝试管理 server 生命周期。",
        "文案明确：完整任务详情、artifact/HTML prototype preview、成员配置在 Web 中查看。"
      ],
      "acceptance": [
        "/studio-feature 能在 CLI 中创建/推进任务。",
        "CLI 显示 plan-review 路径和 Web 打开提示。",
        "awaiting_approval -> implementing 仍只能由用户明确聊天输入触发现有服务器 grant 逻辑。",
        "有后台 Studio run 时 /quit 会提示用户改到 Web 继续查看，不影响已存在 server。"
      ],
      "validation": [
        "手工运行 /studio-feature <small goal> 到 planning/awaiting_approval 前的 smoke（不进入实现）",
        "确认 Web Studio 面板能看到同一 task/session",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "工具事件 payload 形态多样，摘要逻辑必须容错，不因字段缺失崩溃。",
        "不要把 child transcript/raw tool args 大量打印到终端。",
        "不要绕过 Studio 审批硬门禁。"
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "docs-tests-release-check",
      "title": "更新文档、补充 smoke 测试并执行验证",
      "phase": "quality",
      "order": 50,
      "dependsOn": ["cli-contract-health", "server-runner-refactor", "ypic-chat-client", "studio-light-controller"],
      "files": [
        "README.md",
        "docs/deployment/README.md",
        "docs/modules/api.md",
        "docs/architecture/overview.md",
        "docs/modules/library.md",
        "package.json",
        "scripts/test-ypic-cli.mjs"
      ],
      "instructions": [
        "README 增加 ypic 快速开始、与 ypi 的区别、配置跳转、Studio 限制。",
        "deployment 文档补充 npm package runtime 两个 bin 的用法与参数。",
        "architecture/API/library 文档记录 ypic 复用 Web server/API，不新增 session 格式。",
        "可新增轻量 script 测试 CLI 参数解析、SSE parser、health URL 构造等纯函数；若未拆纯函数，至少记录手工 smoke。",
        "执行 lint 和 type-check；不直接运行 next build。"
      ],
      "acceptance": [
        "文档能让用户区分 ypi 和 ypic。",
        "验证命令通过或有明确 blocker。",
        "npm pack --dry-run（如 release 前执行）能包含 bin/ypic.js 和 bin/server-runner.js。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "node bin/ypic.js --help",
        "npm pack --dry-run（仅发布验证时）"
      ],
      "risks": [
        "文档若提到未实现 deep link 会误导用户；首版只承诺打开 Web 根页。",
        "新增 npm script 时同步 package/docs。"
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    }
  ]
}
```

## 验证命令

最低验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
node bin/ypic.js --help
```

建议手工 smoke：

```bash
# 1. 无 ypi server 时，ypic 给出明确提示，引导手动启动 server
node bin/ypic.js --port 30141

# 2. 手动启动 ypi server 后，ypic 复用 server
node bin/pi-web.js --port 30141
node bin/ypic.js --port 30141

# 3. 当前 cwd 创建 session，发送普通消息
# 在 ypic 中输入：hello

# 4. 配置跳转
# 在 ypic 中输入：/config

# 5. Studio 轻入口 smoke（只到规划/审批，不进入实现）
# 在 ypic 中输入：/studio-feature small planning-only test
```

发布前额外验证：

```bash
npm pack --dry-run
```

## 检查门禁

- 实现前必须由主会话保存 implementationPlan，并等待用户确认 plan-review 后进入 implementing。
- `ypi` 兼容性是 blocker：任何导致 `ypi` 不能启动/不能打开浏览器的回归都必须修复。
- `ypic` 不得直接 import 未编译 TypeScript 源文件。
- `ypic` 不得自启 server；health check 失败时只能提示用户手动启动。
- 当前 cwd 尚未加入项目时，需自动建立/注册对应 project/space 上下文，并沿用 canonical path/pathKey 去重。
- Studio approval gate 不得绕过；CLI 只能发送用户聊天输入。
- 新增 API route 必须更新 `docs/modules/api.md`。
