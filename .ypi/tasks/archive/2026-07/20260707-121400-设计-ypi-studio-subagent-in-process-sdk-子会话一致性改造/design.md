# design

## 方案摘要

长期推荐：YPI Studio subagent 从 CLI spawn 改为同进程 SDK runner，并为每个 Studio run 创建**显式持久化 child session**。

核心原则：

1. **一个 run 一个 child session**：child JSONL 记录成员真实对话、工具调用和 provider affinity；`task.json` 仍是 Studio workflow/run 状态权威。
2. **父 session 继续编排**：child 不注入 Studio tools，不写 task lifecycle，不注册 approval/continuation；父 session 通过 `ypi_studio_task/subagent/wait` 推进。
3. **默认不污染历史**：session-reader 识别 `studioChild` header，普通项目历史默认隐藏/折叠，只在父 session 或 Studio run 详情下可见。
4. **事件映射复用现有投影**：SDK `AgentSession.subscribe()` 直接替代 CLI JSON stdout line parser，继续写 transcript sidecar 和 `YpiStudioSubagentRunProgress`。
5. **兼容渐进发布**：先修 bundled CLI fallback，再以 feature flag/auto runner 上 SDK；旧 transcript/run 不迁移不中断。

## 影响模块和边界

### 运行时

- `lib/ypi-studio-extension.ts`
  - 将 `runChildPi()` 拆成 runner interface：`cli` 与 `sdk` 两个实现。
  - `ypi_studio_subagent` / `ypi_studio_wait` 的 tool contract 不变，新增 run/session metadata。
- 新增建议：`lib/ypi-studio-child-session-runner.ts`
  - 负责 SDK child session 创建、header patch、event mapping、abort/finalize/dispose。
- `lib/ypi-studio-subagent-runtime.ts`
  - active handle 增加 `childSessionId`、`childSessionFile`、`runner`；abort 从 kill PID 改为也支持 `AgentSession.abort()`。
- `lib/ypi-studio-transcripts.ts`
  - sidecar 格式保持；可在 transcript ref 上增加 optional `childSessionId/pathLabel`。

### Session / Project

- `lib/types.ts`
  - `SessionHeader` / `SessionInfo` 增加 optional `studioChild`。
- `lib/session-reader.ts`
  - 读取 header 识别 child；`listAllSessions()` 增加 `includeStudioChildren` / `studioChildMode` 选项，默认不作为 root 普通会话返回。
- `app/api/sessions/route.ts`
  - 支持 `includeStudioChildren=1`；默认隐藏或返回 child counts，不污染普通历史。
- `app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts`
  - linked sessions 默认过滤 child；可返回 `studioChildrenByParentSessionId` / counts 给 Sidebar 展开。
- `components/SessionSidebar.tsx`
  - 父 session 下折叠展示 Studio child sessions；child 打开只读审计视图。

### Studio task/run projection

- `lib/ypi-studio-types.ts`
  - `YpiStudioTaskSubagentRun` 增加 `runner`, `childSessionId`, `childSessionFile`, `requestAffinity`。
- `lib/ypi-studio-tasks.ts`
  - `recordYpiStudioSubagentRun()` 兼容 optional fields；旧 run 缺失字段仍正常。
- `lib/ypi-studio-session-link.ts`
  - session widget 继续以父 session/task evidence 为准；忽略 child session 作为主 task widget evidence，防止子会话被当成父会话。
- `components/YpiStudioPanel.tsx` / `components/YpiStudioSubagentTranscript.tsx`
  - 展示 child session metadata，旧 run 无 metadata 时隐藏。

## Child session 文件契约

### Header

创建 child session 时使用标准 SessionManager：

```ts
const childManager = SessionManager.create(root, undefined, {
  parentSession: parentSessionFile,
});
```

随后安全改写第一行 header，保留标准字段并追加：

```json
{
  "type": "session",
  "version": 3,
  "id": "<childSessionId>",
  "timestamp": "2026-07-07T...Z",
  "cwd": "/workspace",
  "parentSession": "/abs/path/to/parent.jsonl",
  "projectId": "<inherited-project-id>",
  "spaceId": "<inherited-space-id>",
  "studioChild": {
    "schemaVersion": 1,
    "kind": "ypi-studio-child-session",
    "runner": "sdk",
    "visibility": "child",
    "status": "running",
    "parentSessionId": "<parentSessionId>",
    "parentSessionFile": "/abs/path/to/parent.jsonl",
    "contextId": "pi_<parentSessionId>",
    "taskId": "<taskId>",
    "runId": "<runId>",
    "member": "architect|implementer|checker|custom",
    "subtaskId": "<optional>",
    "createdAt": "2026-07-07T...Z"
  }
}
```

Finalizer 可 best-effort 更新 `studioChild.status/finishedAt/terminationReason`。但 UI 和 workflow 不应以 header status 为权威；权威状态仍是 `.ypi/tasks/<task>/task.json` 的 `subagents[]`。

### Run record

`YpiStudioTaskSubagentRun` 建议增加 optional 字段：

```ts
{
  runner?: "sdk" | "cli";
  childSessionId?: string;
  childSessionFile?: string;
  requestAffinity?: {
    providerSessionIdSource: "childSessionId";
    parentSessionId?: string;
    childSessionId?: string;
    note?: string;
  };
}
```

旧 run 无这些字段时按现有 transcript projection 显示。

### 为什么不用 in-memory child session

不推荐长期只用 `SessionManager.inMemory()`：

- provider session-affinity/cache headers 仍会有 sessionId，但没有可审计文件和 Sidebar 关联。
- 用户无法从 Studio run 回放 child conversation。
- 服务重启后只能依赖 transcript sidecar，缺少 Pi 原生 JSONL 上下文。

持久化 child session 的成本通过默认隐藏/折叠和只读打开控制。

## SDK runner 设计

### Runner interface

```ts
interface StudioChildRunner {
  start(input: StudioChildRunInput): Promise<ChildPiResult>;
}
```

`ypi_studio_subagent` 不感知 runner 细节：同步模式 `await start()`；异步模式启动 promise 并交给 runtime registry。

### 创建 SDK child AgentSession

SDK runner 应：

1. 创建 child `SessionManager.create(root, undefined, { parentSession })`。
2. 继承父 session header 的 `projectId/spaceId`，写 `studioChild` header。
3. 创建 `DefaultResourceLoader({ cwd: root, agentDir, extensionFactories: [childGuardExtension] })`。
   - 不传 `createYpiStudioExtension()`。
   - 不传 `createBrowserShareExtension()`。
   - childGuardExtension 用于阻断 Studio recursive tools 和可选 `.ypi/tasks/**/task.json` 直接改写。
4. 使用父 session可用的 `modelRegistry/authStorage`，或按 SDK 默认创建同配置 registry。
5. 按 `resolveYpiStudioMemberPolicy()` 的 `modelArg/thinkingArg` 设置 `model/thinkingLevel`。
6. `session.setSessionName("YPI Studio <member> · <short task/run>")`。
7. 订阅 `session.subscribe()`，调用 `session.prompt(childPrompt, { source: "rpc" })`。
8. terminal 后 dispose child session，更新 task run/header/transcript/runtime registry。

### 不使用 process-wide env 作为隔离

CLI runner 通过 `YPI_STUDIO_SUBAGENT_CHILD=1` / `TRELLIS_SUBAGENT_CHILD=1` 禁用递归。SDK 同进程不能在并发 child 中安全设置 `process.env`，否则会影响父 session 或其他 child。

SDK runner 应改用显式 ResourceLoader/profile 隔离：

- 不注入 YPI Studio built-in factory。
- 创建 child-only guard extension。
- `setActiveToolsByName()` 或 `excludeTools` 过滤 `ypi_studio_task`、`ypi_studio_subagent`、`ypi_studio_wait`、Browser Share action tools，以及已知 Trellis subagent tool 名。
- 如外部 project/global extension 仍提供危险递归能力，guard extension 在 `tool_call` 阶段按 toolName 阻断。

## 避免递归、approval gate 和 continuation 错乱

### Studio tools 递归注入

- SDK child ResourceLoader 不加载 built-in YPI extension。
- 即使外部扩展注册同名工具，guard 在 `tool_call` 返回 `{ block: true }`。
- `ypi_studio_subagent` 的 prompt 继续提示“member 只完成角色工作，不创建/切换 Studio task”。

### 子代理再次创建 Studio task

- child 无 `ypi_studio_task` tool。
- task context 注入只来自 `buildMemberPrompt()` 的 bounded snapshot，不注入父 session 的 live Studio extension state。
- `task.contextIds` 不写 child context；child session 不能成为 active task binding。

### approval gate 绕过

- `claimYpiStudioImplementationSubtask()`、`updateYpiStudioImplementationSubtask()`、`transition awaiting_approval -> implementing` 保持 server-side gate。
- child 只能返回结果；父 session collect/finalizer 再调用 persistence helper 写 run/subtask terminal 状态。
- 推荐 child guard 阻止直接 `write/edit` `.ypi/tasks/**/task.json`；bash 写文件只能做命令文本 best-effort 检查，最终仍以 review/validation 防护。

### continuation loop

- runtime continuation key 只使用父 `parentSessionId` / `pi_<parentSessionId>` / parent transcript hash。
- child session id 不注册 continuation callback。
- `studioChild` session 被 session-reader 标记后，`resolveYpiStudioTaskForSession()` 不把它作为主 session widget evidence；打开 child 只显示 child-run 审计。
- async finalizer schedule continuation 时 payload 中保留 `parentSessionId`，并增加 `childSessionId` 仅作 metadata。

## SessionSidebar / Project Registry 处理

### session-reader projection

新增：

```ts
interface StudioChildSessionInfo {
  schemaVersion: 1;
  kind: "ypi-studio-child-session";
  runner: "sdk" | "cli";
  visibility: "child";
  status?: YpiStudioSubagentRunStatus | "runtime_lost";
  parentSessionId?: string;
  taskId: string;
  runId: string;
  member: string;
  subtaskId?: string;
  createdAt?: string;
  finishedAt?: string;
}
```

`SessionInfo` 增加 `studioChild?: StudioChildSessionInfo`。

默认行为：

- `/api/sessions`：普通列表过滤 child root；可返回 `studioChildCountsByParentSessionId`。
- `includeStudioChildren=1`：返回 child session，用 `parentSessionId` 建树。
- project-space sessions route：`sessions` 只含非 child linked sessions；额外字段 `studioChildrenByParentSessionId` 供 Sidebar 展开。
- archived sessions：沿用 archive/unarchive 文件移动；child 默认随父显示，不作为 archived cwd 合成项目依据。

### Sidebar 展示

- 父 session 行显示 child count/status badge。
- child sessions 默认折叠；展开后显示 member/run/status。
- child 选择进入 read-only ChatWindow 或 Session detail view；ChatInput 禁用。
- 如果用户通过 URL 直接打开 child session，仍可读取 JSONL，但 startRpcSession 不应按普通主 Chat 注入 Studio extension。

### 避免污染普通项目历史

- Project Registry 仍是顶层 project source，不因 child session 新增项目。
- child header 继承 projectId/spaceId 是为了关联父空间，不代表它能成为普通 root history。
- legacy exact-cwd 匹配时排除 `studioChild`，避免没有 projectId/spaceId 的 child 被列入“未分配旧会话”。

## SDK events 到现有 progress/transcript 的映射

CLI JSON mode 当前首行 header + JSONL events；SDK runner 没有 stdout header，但 `AgentSession.subscribe()` 事件结构与 JSON mode事件基本一致。

映射复用现有 `parseLine()` 逻辑，但入口从 string 改为 object：

| SDK event | progress/transcript |
| --- | --- |
| `agent_start` | phase=`waiting_model`, status item |
| `message_update` text_delta | phase=`streaming`, token/tps 估算 |
| `message_end` assistant | assistant item, final output candidate, usage tokens |
| `tool_execution_start` | phase=`running_tool`, currentTool, tool_call item |
| `tool_execution_update` | current tool partial preview |
| `tool_execution_end` | tool_result item, error flag |
| `agent_end` | phase=`finished` |
| accepted prompt failure / thrown error | failed run, terminationReason |
| abort signal | cancelled run |

保留现有 cap：line/stdout caps 变为 event/text caps；final-output/transcript/API clipping 仍是 display metadata，不等于失败。

## 模型、thinking 与 request affinity

`resolveYpiStudioMemberPolicy()` 不改 precedence。SDK runner 只消费结果：

- `policy.modelArg` 存在：通过父 `ctx.modelRegistry.find(provider, modelId)` 解析 Model 并传给 `createAgentSession({ model })`；找不到则 warning 并 fallback Pi default。
- `policy.modelArg` 不存在：不传 model，让 Pi SDK 按 settings/default 解析。
- `policy.thinkingArg` 存在：传 `thinkingLevel`；否则不传。
- followMain 时 `ctx.model`/`pi.getThinkingLevel()` 继续作为 main context。

Affinity 说明：

- Pi provider adapters 通常以 `session.sessionId` 参与 `session_id` / `x-client-request-id` / affinity headers 或 WebSocket resource key。
- child 使用独立 `childSessionId`，因此不会与父 Chat 共享完全相同 request fingerprint；这是有意隔离，避免父/子上下文混入同一 provider session。
- 为可解释性，run/header 记录 `parentSessionId`、`childSessionId`、`providerSessionIdSource="childSessionId"`、model/thinking source。
- “与主 Chat 一致”定义为同一 SDK/provider/auth/modelRegistry 路径，而不是复用同一个 provider session id。

## 兼容迁移

- 旧 `.ypi/.runtime/studio-subagents/*.jsonl` transcript 格式不变，继续读取。
- 旧 `task.json subagents[]` 没有 `runner/childSessionId` 时，UI 显示为 `runner=cli/legacy` 或隐藏 session link。
- 发布时不迁移已运行或 running CLI child process；其 finalizer 仍按旧路径写 run。
- 新 run 通过配置选择：`studio.subagents.runner = "auto" | "sdk" | "cli"`。
- `auto` 建议：优先 SDK；如果 SDK session 创建前失败，回退 bundled CLI；如果 SDK 已创建 session/已发起模型请求，不自动回退，避免重复执行。
- 保留 CLI fallback 至少一个版本周期，便于紧急回滚。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| child sessions 过多污染历史 | 默认隐藏/折叠；只在父 session/Studio run 下展示。 |
| child 获得 Studio tools 递归创建任务 | SDK child profile 不注入 built-in Studio extension；guard 阻断同名工具。 |
| approval gate 被 child 绕过 | server-side gate 不变；child 不写 contextIds/approvalGrant；task.json 直接写加 guard + review。 |
| service restart 导致 running SDK child 丢失 | 与现有 async registry 一样标记 `runtime_lost`；child session JSONL/transcript 保留。 |
| request fingerprint 与父 session 不完全一致 | 明确记录 requestAffinity；独立 child sessionId 是隔离设计。 |
| SDK runner 引入不稳定 | 先 bundled CLI fallback，SDK feature flag/auto rollout，保留回滚。 |

## 回滚方案

- 配置 `studio.subagents.runner="cli"` 回到 CLI runner。
- 若 child session UI 有问题，保留 header 字段但 session-reader 默认隐藏即可。
- 新增 run optional fields 不影响旧 task 读取；无需数据迁移回滚。
