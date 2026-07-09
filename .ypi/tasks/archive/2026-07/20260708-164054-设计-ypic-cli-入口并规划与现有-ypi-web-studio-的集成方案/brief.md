# brief

## 任务目标

为当前仓库设计新增 `ypic` CLI 入口的方案与实施计划：保留现有 `ypi` Web 启动入口定位不变，新增一个面向当前目录聊天的轻量 CLI，让用户在终端中以常见 AI CLI 的方式进入会话，同时复用现有 ypi Web / AgentSession / YPI Studio 能力。

## 已确认约束

1. `ypi` 已用于启动 Web 工作台，不改变其现有行为和定位。
2. 新增 `ypic` 作为 CLI 入口，可直接依赖现有 `ypi` Web server/API/Studio 能力。
3. CLI 默认以 `process.cwd()` 作为会话工作目录，首条消息创建/绑定该 cwd 的 pi session。
4. 复杂配置不在 CLI 内实现；CLI 只提供跳转/打开浏览器到 Web 页面配置的入口。
5. CLI 只覆盖 chat 内操作，不搬运文件浏览器、项目侧栏、设置页、完整 Studio 工作台等 Web UI。
6. YPI Studio 在 CLI 中作为轻入口与控制器：可通过 slash command 发起/继续/检查工作流，展示紧凑状态和 plan-review 提示，但 artifact 预览、成员/任务详情和配置仍以 Web 为主。
7. 当前阶段只做 intake/planning，不进入实现，不提交、不推送。

## 证据与现状

- `package.json` 当前仅暴露 `bin.ypi = bin/pi-web.js`，发布包 `files` 已包含整个 `bin/` 目录。
- `bin/pi-web.js` 负责启动 Next `.next` 产物并在 Ready 后自动打开浏览器。
- Web chat 的会话生命周期集中在 `app/api/agent/new`、`app/api/agent/[id]`、`app/api/agent/[id]/events`、`lib/agent-session-bootstrap.ts`、`lib/rpc-manager.ts`。
- `lib/rpc-manager.ts` 已在 Web-created AgentSession 中注入 YPI Studio extension 与 Browser Share extension；复用这些 API 可让 `ypic` 继承 Studio 工具/命令能力。
- YPI Studio 工作流要求 planning 阶段生成 `plan-review.md` 作为审批主入口，且实现前需要用户明确确认。

## 推荐方向

采用“`ypic` 作为本地终端控制器，背后复用/拉起同包内 ypi Web server”的方案，而不是在 `ypic` 中另起一套独立 Pi SDK runtime。这样可避免复制 Studio extension、会话 JSONL、模型配置、认证 reload、usage rollup、Browser Share/Studio guard 等复杂逻辑。
