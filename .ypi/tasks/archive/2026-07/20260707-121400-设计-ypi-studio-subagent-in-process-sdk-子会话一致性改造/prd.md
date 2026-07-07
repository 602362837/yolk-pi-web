# prd

## 目标与背景

YPI Studio subagent 应与主 Chat 使用同一类 in-process SDK 集成，而不是依赖外部 CLI。长期目标是：

1. 消除用户未安装全局 `pi` 或 PATH 不一致导致的 subagent 启动失败。
2. 让 Studio child run 拥有可审计、可关联、可隐藏/折叠展示的持久 session。
3. 让 provider/auth/model 请求路径与主 Chat 一致，同时明确 child 独立 sessionId 带来的 request affinity 差异。
4. 保持现有 `ypi_studio_task` / `ypi_studio_subagent` / `ypi_studio_wait`、approval gate、async continuation、旧 transcript 兼容。

## 范围内

- 新增 Studio child SDK runner，替代 `runChildPi()` 的 CLI JSON stdout 解析主路径。
- 每个 Studio run 创建一个持久化 child session JSONL，并在 header 标记 `studioChild` 元数据。
- `session-reader` / SessionSidebar / Project Registry route 支持识别和默认隐藏或折叠展示 child session。
- 将 SDK `AgentSession.subscribe()` 事件映射到现有 `YpiStudioSubagentRunProgress`、transcript sidecar、`onUpdate`、runtime registry、wait/cancel。
- 保留 `resolveYpiStudioMemberPolicy()` 的 precedence：`toolInput > memberConfig > defaultPolicy > followMain > piDefault`。
- CLI fallback 和旧 `.ypi/.runtime/studio-subagents` transcript/run records 继续可读。

## 范围外

- 不改变 YPI Studio workflow 状态机和 artifact 命名规则。
- 不把 child session 作为新的 Project Registry 顶层项目或普通会话来源。
- 不允许 child session 绕过父 session approval gate 自动进入 implementation。
- 不做旧 CLI ephemeral child run 的历史回填；旧 run 仍只有 transcript sidecar。

## 需求与验收标准

### R1. SDK child runner

- 当 Studio subagent 启动时，不依赖 PATH 中的 `pi`。
- 使用 `createAgentSession()` 创建 child `AgentSession`，并通过 `subscribe()` 接收事件。
- 验收：在无全局 `pi` 的环境中，SDK runner 能启动 architect/checker child run；`task.json` run 进入 terminal 状态。

### R2. 持久化 child session 与关联元数据

- child session header 包含 `studioChild`：`schemaVersion`、`kind`、`parentSessionId`、`parentSessionFile`、`contextId`、`taskId`、`runId`、`member`、`subtaskId`、`status`、`createdAt/finishedAt`、`runner`。
- 标准 `parentSession` 指向父 session file；`projectId/spaceId` 继承父 session。
- 验收：通过 session-reader 可识别 child session 并解析关联；Studio run projection 可显示 childSessionId/childSessionFile。

### R3. 安全边界

- child SDK session 默认不注入 `ypi_studio_task`、`ypi_studio_subagent`、`ypi_studio_wait`、Browser Share 工具。
- child run 不写 `task.contextIds`，不注册父 continuation alias，不记录 approvalGrant。
- 实现子任务 claim/start/done/failed 仍只由父 session Studio tools 在 `implementing` 状态下执行。
- 验收：child prompt 中即使尝试调用 Studio task/subagent tool，也不可用；`awaiting_approval -> implementing` 仍需要父 session 显式用户确认。

### R4. Sidebar / Project History

- 普通项目历史默认不被 child sessions 污染。
- 当父 session 可见时，child sessions 可作为折叠的 “Studio children” 展示，带 member/run/status 标记。
- 当父 session 不可见或被归档时，child session 默认隐藏，只能从 Studio run 详情或调试开关进入。
- 验收：普通 session 列表不新增大量 child root；展开父 session 可看到 child count/status。

### R5. Progress / Transcript / Wait / Cancel

- SDK events 映射到现有 run progress fields：phase、tokens/tps、currentTool、itemsPreview、warnings、display、terminationReason。
- transcript sidecar 继续写 `.ypi/.runtime/studio-subagents/`，同时 run 记录补充 child session refs。
- cancel 调用 `AgentSession.abort()` 并持久化 cancelled run/subtask。
- 验收：`ypi_studio_wait` 可等待 SDK child terminal；取消后 UI、task.json、transcript、runtime registry 一致。

### R6. Model / Thinking / Affinity

- 继续使用 `resolveYpiStudioMemberPolicy()`；policy diagnostics 进入 run progress/final result。
- child 尽量复用父 session 的 SDK auth/model registry 请求路径。
- 因 child 独立 sessionId 会产生独立 provider affinity/request fingerprint，必须在 run/header 记录 parent/child sessionId 和 affinity source。
- 验收：followMain 模式下 child 使用主 session provider/model；run projection 显示 childSessionId 与 requestAffinity 说明。

### R7. 兼容迁移

- 旧 transcript/run records 无 childSessionId 时仍按现有 projection 读取。
- 发布后已运行的 CLI child process 不迁移不中断；新 run 由配置决定 runner。
- 保留 CLI fallback 至少一个版本周期。
- 验收：旧任务详情、Subagents tab、Transcript route 均正常读取。

## 未决问题 / 需要主会话确认

1. SDK runner 首版是否默认开启，还是先以 `studio.subagents.runner = "sdk"` feature flag 灰度？推荐：先 `auto`，优先 SDK，创建前失败回退 bundled CLI；稳定后默认 SDK。
2. child session 是否允许从 Sidebar 点击后继续对话？推荐：只读审计；继续工作必须回到父 session。
3. 是否需要强制 child guard 阻止写 `.ypi/tasks/**/task.json`？推荐首版加入工具级 guard，bash 只能做 best-effort。
