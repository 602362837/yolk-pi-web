# design

## 方案摘要

保留 `ypic` 的既有轻客户端架构：`bin/ypic.js` 仍只使用 Node built-ins，通过 HTTP/SSE 复用 ypi Web server，不直接嵌入 Pi SDK。修复重点放在 CLI 客户端层：命令分发补齐 `/model`，发送流程增加 SSE connected / pending 状态，渲染层增加 TTY frame（固定底部输入和状态栏）与 plain fallback。

## 当前架构梳理

### 启动

`bin/ypic.js`：

1. `parseCliArgs()` 解析 `--port`、`--hostname`、`--continue`、`--resume`、positional message。
2. `checkHealth()` 调 `GET /api/cli/health`，确认目标是 `yolk-pi-web`。
3. `resolveProjectContext()` 调 `/api/projects` 找到或注册 cwd project/space。
4. `draftSession()` 调 `POST /api/agent/draft` 创建空 session。
5. `connectSse()` 连接 `GET /api/agent/:id/events`。
6. `readline.createInterface()` 进入 line loop。

### 命令分发

`handleLine()` 当前内建命令：`/help`、`/quit`、`/config`/`/open`、`/oweb`、`/status`、`/abort`、`/steer`、`/follow`。未知 `/...` 会作为普通 prompt 发送，以便 `/studio-*` 透传。

缺口：没有 `/model` 分支，也没有加载 `/api/models` 的模型列表和 thinking level 数据。

### 消息提交

- idle 时：`POST /api/agent/:id { type: "prompt", message }`。
- running 时：默认 `steer`，`/follow` 可排队。
- 服务端 `lib/rpc-manager.ts` 中 `AgentSessionWrapper.send("prompt")` 会调用 `inner.prompt()` 并等待 preflight；`set_model`、`set_thinking_level` 已存在。

缺口：CLI 在等待 POST/preflight 时没有稳定 UI 状态；`connectSse()` 不是 awaitable，首条/早期消息没有显式等待 `connected`。

### 渲染

`createRenderer()` 处理 SSE event，直接 `process.stdout.write()` assistant delta、tool start/end、Studio 摘要、agent_end/error。输入由 `readline` prompt 负责。

缺口：历史输出与输入混在同一终端流，无法固定底部输入，也无法持续显示当前模型/状态。

## 影响模块和边界

| 模块 | 改动 |
| --- | --- |
| `bin/ypic.js` | 主要改动：模型状态加载、`/model` 命令、TTY frame renderer、SSE connected gate、send timeout/状态反馈、help/startup 文案。 |
| `scripts/test-ypic-cli.mjs` | 增加纯函数/小单元测试：model arg 解析、thinking 选择、frame fallback 判断、SSE connected gate parser。 |
| `README.md` | 更新 `ypic` 启动提示、`/model` 用法、底部输入/TTY fallback。 |
| `docs/deployment/README.md` | 更新 `ypic` terminal chat 命令和手工验收。 |
| `docs/architecture/overview.md` | 如新增明显数据流/渲染不变量，补充 CLI rendering/command boundary。 |
| `docs/modules/api.md` | 若不新增 API，可不改；若为 CLI 增加专用 route 才更新。首选不新增。 |

## 数据流 / API / 文件契约

### 模型数据

复用现有：

```text
GET /api/models
  -> { modelList, defaultModel, thinkingLevels, thinkingLevelMaps }
```

CLI 内维护：

```js
modelState = {
  list,
  defaultModel,
  thinkingLevels,
  thinkingLevelMaps,
  current: { provider, modelId } | null,
  thinkingLevel: "auto" | "off" | "low" | "medium" | "high" | "xhigh"
}
```

当前模型来源优先级建议：

1. `GET /api/agent/:id` 返回的 live state `state.model` / `state.thinkingLevel`。
2. `/api/models.defaultModel`。
3. `modelList[0]` fallback，仅用于展示/选择，不静默设置。

### `/model` 命令契约

建议支持：

```text
/model                         打开交互选择
/model list                    列出可用模型
/model current                 显示当前模型/thinking
/model <provider>/<modelId>    直接切换模型
/model <provider>/<modelId> <thinking>
/model thinking <level>        只切换 thinking
```

执行：

```text
POST /api/agent/:id { type: "set_model", provider, modelId }
POST /api/agent/:id { type: "set_thinking_level", level }
```

不新增 session 格式；服务端会写 Pi session 的 model_change / thinking state（沿用现有行为）。

### TTY frame 渲染

新增内部抽象（命名建议）：

- `TerminalFrame`：负责 ANSI TTY 下的分隔线、底部状态/输入重绘、resize、输出区域写入。
- `PlainFrame`：非 TTY fallback，保持当前 `process.stdout.write()` + `readline.prompt()` 行为。

边界：仍在 `bin/ypic.js` 内或同目录 CommonJS helper 内，不 import TS，不新增重依赖。

状态栏字段：

```text
left: session/status (idle | waiting_model | streaming | running_tool)
right: provider/modelId · thinking
hints: /model /config /oweb /quit
```

### 无响应修复策略

1. `connectSse()` 增加 connected promise 或回调，`main()` 在允许首条发送前等待 `connected`（有超时和 warning）。
2. `handleLine()` 在发 POST 前立即更新状态：`sending` / `waiting_model`。
3. `sendAgentCommand()` 外层增加合理超时或至少显示 elapsed hint；不要让 preflight 长时间静默。
4. `_sse_error`、`_sse_closed`、`agent_error`、POST error 都进入统一 `setStatus(error, message)`。
5. `YPIC_DEBUG=1` 保留 raw event debug，并可新增 HTTP timing debug。

## 兼容性

- `ypi` Web 行为不变。
- `ypic` 仍不自启 server。
- `ypic` 仍通过 `/api/agent/*` 复用 Studio、Browser Share、usage、auth reload 等服务端能力。
- 非 TTY/pipe/CI 不启用 ANSI 固定底栏，避免破坏脚本输出。
- CommonJS + Node built-ins 约束不变。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| ANSI 固定底栏破坏不同终端 | 仅 TTY 启用；提供 `YPIC_PLAIN=1`/`NO_COLOR` fallback；resize 重绘；手工覆盖 macOS Terminal/iTerm/VSCode terminal。 |
| `/model` 与 `/studio-*` slash 透传冲突 | 只拦截精确 `/model` 前缀；其他未知 slash 仍透传。 |
| 首条消息仍有 SSE 竞态 | 等待 `connected` 或超时 warning；测试 positional message 和交互首条消息。 |
| 模型切换期间 agent running | 建议 running 时禁用 `/model` 或明确提示先 `/abort`/等待完成；避免中途改模型导致状态不一致。 |
| thinking levels 与模型能力不一致 | 使用 `/api/models.thinkingLevels`；无支持时只允许 `off/auto` 或调用服务端后显示错误。 |

## 回滚

- 可用 `YPIC_PLAIN=1` 或配置开关禁用 TTY frame，保留 plain readline。
- 若 `/model` 新交互异常，可保留直接命令 `/model current/list` 与 `/config`，临时关闭交互选择。
- 所有改动集中在 CLI 客户端和 docs/tests；服务端 API/JSONL 不变，回滚风险低。
