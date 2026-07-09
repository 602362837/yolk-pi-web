# design

## 方案摘要

推荐采用 **ypic CLI 控制器 + 现有 ypi Web server/API** 架构：

- `ypi` 保持现有 Web 启动入口。
- 新增 `ypic` bin，启动后在终端提供 chat loop。
- `ypic` 优先连接本机已运行的 ypi server；若未检测到 server，则不给自动启动，而是提示用户先手动启动 `ypi`/Web server。
- `ypic` 通过现有 HTTP/SSE API 创建 session、发送 prompt、接收流式事件、执行 abort/steer/follow-up 等 chat 操作。
- YPI Studio 继续由 `lib/rpc-manager.ts` 注入的内建 extension 驱动，CLI 只发送 slash commands 和展示紧凑状态，不复制 Studio 面板。

该方案比“ypic 直接嵌入独立 Pi SDK runtime”风险更低：避免重复维护 Studio extension factory、session lifecycle、auth reload、usage rollup、Browser Share/child guard、approval gate 和 JSONL 兼容逻辑。

## 影响模块和边界

### CLI / 发布入口

- `package.json`
  - 增加 `bin.ypic = bin/ypic.js`。
  - `files` 已包含 `bin`，若新增 `bin/server-runner.js` 会随包发布。
- `bin/pi-web.js`
  - 建议提取 server 启动公共逻辑，保持 `ypi` 默认打开浏览器。
- `bin/server-runner.js`（新增）
  - CommonJS 公共启动器：解析 port/hostname/proxy/no-proxy，启动 Next CLI，检测 Ready，按参数决定是否打开浏览器。
  - 首版主要供 `ypi` 复用；`ypic` 不负责自启 server。
- `bin/ypic.js`（新增）
  - CommonJS CLI；不得依赖未编译的项目 TS 源码，避免发布包无法执行。

### API / server

优先复用现有 API：

- `POST /api/agent/new`：当前 cwd 首条消息创建 session。
- `POST /api/agent/[id]`：发送 prompt/steer/follow_up/abort/get_state 等命令。
- `GET /api/agent/[id]/events`：SSE 流式事件。
- `GET /api/sessions/[id]/studio-task`：可选，用于退出前判断 Studio 后台运行状态。
- `GET /api/sessions`：可选，用于 `--continue` 查找当前 cwd 最近 session。

建议新增一个很小的健康检查路由：

- `GET /api/cli/health`
  - 返回 `{ ok: true, app: "yolk-pi-web", version, pid, cwd?, capabilities: { agentApi: true, studio: true } }`。
  - 用于 `ypic` 区分“目标 ypi server 已运行”和“端口被其他服务占用”。
  - 不返回 secrets，不改变现有 API 行为。

### Library / 会话生命周期

- 不新增独立 session store。
- `ypic` 创建的 session 仍走 `createConfiguredEmptyAgentSession()` 与 `startRpcSession()`，从而保持：
  - `globalThis.__piSessions` 单 wrapper invariant；
  - Studio/Browser Share extension 注入；
  - tool call normalization、file-change sidecar、usage accounting；
  - approval gate 和 child continuation 行为。

### Docs

- `README.md`：新增 `ypic` 快速开始与定位。
- `docs/deployment/README.md`：新增 npm package runtime / CLI options。
- `docs/modules/api.md`：若新增 `/api/cli/health`，补充 route map。
- `docs/architecture/overview.md`：补充 `ypic` 复用 Web API 的运行流。

## 数据流 / API / 文件契约

### 启动和 server 复用

```text
Terminal ypic
  ├─ GET http://127.0.0.1:<port>/api/cli/health
  │    ├─ ok: reuse server
  │    └─ fail: print guidance to start `ypi` / Web server manually
  └─ enter chat loop bound to process.cwd() after server is available
```

### 首条消息

```text
ypic input
  ├─ GET /api/agent/<sid>/events after session id exists
  └─ POST /api/agent/new { cwd, type:"prompt", message, toolNames? }
        └─ createConfiguredEmptyAgentSession()
             └─ startRpcSession() injects YPI Studio + Browser Share extensions
```

实现细节：

- `ypic` 可先调用 `/api/agent/draft` 创建空 session，再连接 SSE，再发 prompt；这能最大化避免首条消息早期事件丢失。
- 若选择直接 `/api/agent/new`，也可行，因为 `AgentSessionWrapper.send(type:"prompt")` 只等待 preflight 后返回，但 draft+events+prompt 的事件顺序更清晰。

### 后续消息

```text
ypic input
  ├─ if agent idle: POST /api/agent/<sid> { type:"prompt", message }
  ├─ if agent running and user chooses steer: POST { type:"steer", message }
  └─ if agent running and user chooses follow-up: POST { type:"follow_up", message }
```

### SSE 渲染

`ypic` 解析 `data: {...}` 行并只渲染紧凑事件：

- assistant text delta：直接流式输出。
- tool start/end：单行 `tool <name> … ✓/✗`，raw JSON 默认隐藏。
- `ypi_studio_task` / `ypi_studio_subagent` / `ypi_studio_wait`：显示 task/run/member/status/phase/tps/plan-review 路径等紧凑摘要。
- `agent_end`：回到 prompt。
- `agent_error`：显示错误并回到 prompt。

### 配置跳转

- `/config`、`/open`、需要配置的错误提示只打开 `http://host:port/`。
- 首版不新增 Web deep link；若后续要 `?settings=studio` 自动打开设置弹窗，属于 Web 交互变化，需要另行 UI 门禁。
- 当前目录若尚未注册为 project/space，`ypic` 应在创建/绑定 session 时通过现有项目 API 自动建立对应上下文，避免用户先到 Web 添加项目。

### Project Registry 兼容

MVP 需要在必要时自动写入/建立 Project Registry 上下文：

- 若当前 cwd 尚未是已知 project/space，`ypic` 应调用现有项目 API 自动注册或建立对应上下文。
- session header 的 `cwd` 仍是底层绑定依据，但 Web/Studio 侧应能把该目录视为正常项目空间。
- 需避免重复注册：应基于 canonical path/pathKey 去重，沿用现有 Project Registry 规则。

## CLI 命令契约（建议）

| 命令 | 行为 |
| --- | --- |
| `ypic` | 当前 cwd 新建 chat loop，首条消息创建 session。 |
| `ypic "message"` | 将参数作为第一条消息发送，然后继续进入 chat loop。 |
| `ypic --port 8080` | 连接指定端口 server；若未运行则提示用户先手动启动。 |
| `ypic --hostname 127.0.0.1` | 指定 server host。 |
| `ypic -c, --continue` | 尝试续接当前 cwd 最近 session；找不到则新建。 |
| `/help` | 显示 CLI 内命令。 |
| `/config` 或 `/open` | 打开 Web。 |
| `/quit` | 退出；若有 Studio 后台 run，保留 server 并提示。 |
| Ctrl-C | agent running 时 abort；idle 时二次 Ctrl-C 退出。 |

## YPI Studio 集成策略

- Studio 发起：用户直接输入 `/studio-feature ...`、`/studio-bugfix ...`、`/studio-continue`。
- Studio 审批：CLI 不写 approval grant；只把用户明确输入发送给同一 chat，由现有 `recordYpiStudioUserApproval()` 路径处理。
- Studio artifact：CLI 显示 task-local path 和 Web URL，不在终端渲染 HTML 原型或 artifact tabs。
- Studio 子代理：CLI 展示 `ypi_studio_subagent`/`ypi_studio_wait` 的轻量状态；后台并发、continuation、approval gate 仍由 server 管理。
- 由于 `ypic` 不自启 server，退出时无需承担 server 生命周期管理；只需在存在后台任务时提示用户改到 Web 查看。

## 兼容性、风险、回滚

### 兼容性

- `ypi` 行为不变；`ypic` 是 additive bin。
- 不改变 session JSONL 格式。
- 不改变 existing Web UI routes 和 Studio approval gate。
- `bin/ypic.js` 使用 Node 22+，与项目运行要求一致。

### 主要风险

1. **发布包运行时依赖 TS 源码不可用**：`ypic` 必须用 CommonJS/纯 JS 或发布构建产物，不直接 import `lib/*.ts`。
2. **端口被其他服务占用**：增加 `/api/cli/health`，不匹配时给出明确错误。
3. **首条消息 SSE 事件丢失**：推荐 draft -> connect events -> prompt 顺序。
4. **自动项目注册重复或脏数据**：基于 canonical path/pathKey 去重，复用现有 Project Registry 规则。
5. **Web deep link 诱发 UI 变更**：首版只打开 Web 根页，避免扩大范围。

### 回滚

- 若 `ypic` 出现问题，可从 `package.json` 移除 `bin.ypic` 并删除新增 `bin/ypic.js` / health route；`ypi` Web 入口不受影响。
- 若公共 server-runner 引入回归，可先恢复 `bin/pi-web.js` 原逻辑，让 `ypic` 独立复制启动逻辑作为临时隔离。
