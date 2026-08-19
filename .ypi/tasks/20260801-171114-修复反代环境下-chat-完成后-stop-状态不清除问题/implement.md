# Implement：Chat SSE 终态可靠收敛

> 当前仅为实施计划，不修改生产代码。UI HTML 原型与用户批准是所有实现子任务的前置门禁。

## 需先阅读的文件

- `AGENTS.md`
- `docs/architecture/overview.md`（Runtime Flow、AgentSession lifecycle、Studio child continuation）
- `docs/modules/frontend.md`（`ChatWindow` / `ChatInput` / `useAgentSession`）
- `docs/modules/api.md`（agent state / SSE routes）
- `docs/modules/library.md`（`rpc-manager`）
- `docs/standards/code-style.md`
- `hooks/useAgentSession.ts`
- `components/ChatWindow.tsx`
- `components/ChatInput.tsx`
- `app/api/agent/[id]/events/route.ts`
- `app/api/agent/[id]/route.ts`
- `app/api/sessions/[id]/route.ts`（`includeState`）
- `lib/rpc-manager.ts`
- `app/api/files/[...path]/route.ts`（现有 anti-buffering SSE header 模式）
- `bin/ypic.js`、`scripts/test-ypic-cli.mjs`（additive wire 兼容）
- 本任务 [Brief](brief.md)、[PRD](prd.md)、[UI](ui.md)、[Design](design.md)、[Checks](checks.md)

## 人类可读子任务表

| ID | 阶段 | 顺序 | 子任务 | 依赖 | 可并行 | 本地评审 |
| --- | --- | ---: | --- | --- | --- | --- |
| `UI-00` | Gate | 0 | UI 设计员 HTML 原型与用户审批 | — | 否 | 是 |
| `SSE-01` | Server | 1 | 建立 race-safe runtime snapshot 与 Chat SSE anti-buffering handshake | UI-00 | 是 | 是 |
| `FE-02` | Client | 1 | 实现连接代次、权威状态补偿与幂等终态 | UI-00 | 是 | 是 |
| `TEST-03` | Test | 2 | 补 focused race/proxy/reconnect/Studio/兼容测试 | SSE-01, FE-02 | 否 | 是 |
| `DOC-04` | Docs | 2 | 对齐 architecture/API/frontend/library/deploy/troubleshooting | SSE-01, FE-02 | 是 | 是 |
| `CHECK-05` | Verify | 3 | 自动门禁与真实反代人工验收 | TEST-03, DOC-04 | 否 | 是 |

## 执行步骤

### UI-00：先完成硬门禁

1. 主会话派发 `ui-designer`。
2. UI 设计员基于现有 ChatInput 产出任务目录内 `.html`。
3. 更新 `ui.md` 和 `plan-review.md` 相对链接。
4. 用户先批准原型，再批准整体计划。
5. 主会话保存本 implementationPlan 并切到 `awaiting_approval`；用户明确批准后才能进入 implementing。

### SSE-01：服务端契约

1. 提取浏览器安全 `AgentRuntimeSnapshot` / `getRuntimeSnapshot()`。
2. 普通 SSE 先订阅 listener，再同步发 `connected.state`。
3. 统一 Chat SSE headers：`no-cache, no-store, no-transform` + `X-Accel-Buffering: no`。
4. 为普通 stream 增加 idempotent cleanup、enqueue failure cleanup、abort listener removal。
5. 保持 Studio child audit branch 与旧事件兼容。

### FE-02：前端状态机

1. 抽取纯 `projectAgentRuntimeActivity()`，禁止使用 wrapper alive 作为 turn active。
2. 为 EventSource 建立 session/generation/reason 标识。
3. 增加可取消、single-flight 的 runtime probe。
4. `onerror`：probe → active 则重连，idle 则统一结束，失败则 fail-safe。
5. `connected.state`：仅在满足 turn evidence / reconnect 规则时应用 idle。
6. 增加 running-only watchdog；初始 optimistic send 使用保护期。
7. 提取 per-turn 幂等 `convergeAgentTurnEnd`，统一真实/补偿终态、声音、回调、reload、cleanup。
8. session 切换/unmount 清理 EventSource、timer、probe 和 generation。

### TEST-03：focused tests

优先新增 `scripts/test-agent-sse-recovery.mjs` 与 package script `test:agent-sse-recovery`。测试用 fake snapshot/fetch/timers/source，不访问真实模型网络或用户 agentDir。

至少覆盖：

- anti-buffering headers；
- subscribe-before-snapshot contract；
- active/idle/Studio activity pure projection；
- turn_start idle snapshot 不误结束；
- agent_end 丢失 + reconnect idle 自愈；
- 连接不报错 + watchdog idle 自愈；
- probe 失败保持 running；
- late real `agent_end` 恰好一次；
- session generation stale response 丢弃；
- abort 后终态补偿；
- `ypic` 忽略 additive connected state。

### DOC-04：文档

更新：

- `docs/architecture/overview.md`
- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `docs/deployment/README.md`
- `docs/operations/troubleshooting.md`
- 如新增 package test，同步 `docs/standards/code-style.md` 测试列表。

### CHECK-05：最终 barrier

执行自动检查、真实浏览器和反代环境验收。任何错误 idle、重复完成回调、Studio child 误清或 UI drift 都是 blocker。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "title": "修复反代环境下 Chat 完成后 Stop 状态不清除",
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "UI-00",
      "title": "完成 Chat Stop/Send 状态时序 HTML 原型与用户审批",
      "phase": "gate",
      "order": 0,
      "dependsOn": [],
      "files": [
        ".ypi/tasks/20260801-171114-修复反代环境下-chat-完成后-stop-状态不清除问题/ui.md",
        ".ypi/tasks/20260801-171114-修复反代环境下-chat-完成后-stop-状态不清除问题/plan-review.md",
        ".ypi/tasks/20260801-171114-修复反代环境下-chat-完成后-stop-状态不清除问题/chat-stop-recovery-prototype.html"
      ],
      "instructions": "由 YPI Studio ui-designer 基于现有 ChatInput 产出 HTML 状态原型，覆盖 idle、running、reconnect-active、recovered-idle、waiting-for-Studio-children；不得新增视觉元素。主会话向用户请求原型审批并把审批记录/相对链接写回 ui.md 与 plan-review.md。该 gate 未完成前禁止实现。",
      "acceptance": [
        "任务目录存在 ui-designer 产出的可预览 HTML 文件",
        "原型确认 Stop/Send 样式与布局不变，只修正状态时序",
        "用户已明确批准 HTML 原型",
        "ui.md 与 plan-review.md 含有效相对链接和审批记录"
      ],
      "validation": [
        "通过 Studio task-local HTML preview 打开原型",
        "桌面与 375px 状态切换人工检查",
        "检查用户审批记录"
      ],
      "risks": [
        "把可靠性修复误扩成新 UI",
        "纯 Markdown 被误当作 HTML 原型"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "SSE-01",
      "title": "建立 race-safe runtime snapshot 与 anti-buffering SSE handshake",
      "phase": "server",
      "order": 1,
      "dependsOn": ["UI-00"],
      "files": [
        "lib/rpc-manager.ts",
        "lib/agent-runtime-state.ts",
        "app/api/agent/[id]/events/route.ts"
      ],
      "instructions": "新增只含 isStreaming/studioChildRunCount/isCompacting 的同步安全 snapshot；普通 SSE 在无 await 的同步区间先 subscribe 再读 snapshot 并发 additive connected.state；Chat SSE 响应补齐 no-cache,no-store,no-transform 与 X-Accel-Buffering:no；普通/child stream cleanup 幂等、enqueue 失败可清理。不得泄露路径、正文、prompt、model/auth 或 tool 内容。",
      "acceptance": [
        "connected.state 能区分 active、idle 与 Studio background activity",
        "subscribe-before-snapshot 消除检查后订阅窗口",
        "普通与 Studio audit SSE 都有 anti-buffering headers",
        "重复 abort/cancel/close 不抛未处理异常",
        "旧事件类型和 route path 不变"
      ],
      "validation": [
        "npm run test:agent-sse-recovery",
        "route header contract test",
        "runtime snapshot privacy assertion",
        "git diff review for no await between subscribe and snapshot"
      ],
      "risks": [
        "错误把 wrapper alive 当作 isStreaming",
        "snapshot 泄露不必要 runtime 数据",
        "cleanup 重入导致 double close"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "FE-02",
      "title": "实现 Web 连接代次、权威状态补偿、watchdog 与幂等终态",
      "phase": "client",
      "order": 1,
      "dependsOn": ["UI-00"],
      "files": [
        "hooks/useAgentSession.ts",
        "lib/agent-runtime-state.ts",
        "components/ChatWindow.tsx"
      ],
      "instructions": "把 EventSource 连接标记为 turn_start/resume/reconnect 并使用 generation；新增 running-only、可取消 single-flight runtime probe/watchdog；active 判定只用 state.isStreaming || studioChildRunCount>0；初始 prompt 前 idle snapshot 有保护期；查询失败 fail-safe；真实 agent_end、reconnect idle、watchdog idle 复用 per-turn compare-and-set 终态，恰好一次完成回调/提示音/reload/cleanup。不得新增 UI 文案或控件。",
      "acceptance": [
        "丢失 agent_end 后无需刷新恢复 Send",
        "仍 streaming 或 Studio child>0 时保持 Stop/后台状态",
        "初始 connect 早于 prompt 时不误清 running",
        "旧 session/generation probe 不能污染当前 Chat",
        "每 turn 最多一次 onAgentEnd 与完成提示音",
        "idle 状态不存在 polling"
      ],
      "validation": [
        "npm run test:agent-sse-recovery",
        "fake timer race tests",
        "manual Chat send/abort/reconnect smoke",
        "React cleanup review"
      ],
      "risks": [
        "watchdog 过早判断 idle",
        "闭包/Ref generation 竞态",
        "真实迟到 agent_end 重复完成",
        "watchdog 形成常驻请求"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "TEST-03",
      "title": "补齐 SSE 代理、丢帧、重连和 Studio 回归测试",
      "phase": "test",
      "order": 2,
      "dependsOn": ["SSE-01", "FE-02"],
      "files": [
        "scripts/test-agent-sse-recovery.mjs",
        "package.json",
        "scripts/test-ypic-cli.mjs"
      ],
      "instructions": "使用临时/fake runtime、fetch、timers 和流，不访问 provider 网络或用户 agentDir。覆盖 headers、handshake ordering、activity projection、初始 idle 竞态、断线期间完成、尾帧扣留 watchdog、probe fail-safe、Studio child、late end 幂等、stale generation、abort 与 ypic additive wire 兼容。",
      "acceptance": [
        "每个 PRD R1-R10 至少有自动或明确人工覆盖",
        "丢帧与重连测试无需真实模型",
        "测试可重复且不依赖固定端口/用户数据",
        "ypic 现有 SSE parser 兼容 connected.state"
      ],
      "validation": [
        "npm run test:agent-sse-recovery",
        "npm run test:ypic-cli",
        "重复运行 focused suite 两次"
      ],
      "risks": [
        "只做字符串断言而未验证状态时序",
        "fake timer 未清理导致测试假通过"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "DOC-04",
      "title": "对齐 SSE 状态真相、代理配置与排障文档",
      "phase": "docs",
      "order": 2,
      "dependsOn": ["SSE-01", "FE-02"],
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/deployment/README.md",
        "docs/operations/troubleshooting.md",
        "docs/standards/code-style.md"
      ],
      "instructions": "记录 connected.state additive wire、wrapper alive 与 turn active 区别、subscribe-before-snapshot、running-only watchdog、幂等终态、Nginx buffering/streaming 推荐配置、多实例 affinity 剩余风险及 focused test。文档不得承诺客户端能绕过完全不支持 SSE 的网关。",
      "acceptance": [
        "架构/API/frontend/library 文档与最终代码一致",
        "部署/排障包含 headers、state.isStreaming、Studio child 与 affinity 检查",
        "新增 package script 已加入测试清单"
      ],
      "validation": [
        "文档链接检查",
        "rg connected.state/X-Accel-Buffering/state.isStreaming",
        "localReview 对照代码契约"
      ],
      "risks": [
        "把应用 outbound provider proxy 与 inbound reverse proxy 混淆",
        "文档误导为任意 CDN 均可自愈"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "CHECK-05",
      "title": "执行自动门禁与真实反向代理人工验收",
      "phase": "verify",
      "order": 3,
      "dependsOn": ["TEST-03", "DOC-04"],
      "files": [
        ".ypi/tasks/20260801-171114-修复反代环境下-chat-完成后-stop-状态不清除问题/checks.md",
        ".ypi/tasks/20260801-171114-修复反代环境下-chat-完成后-stop-状态不清除问题/review.md"
      ],
      "instructions": "运行 focused tests、lint、tsc、diff check；在本地直连和真实远程反代各验证正常完成、断线重连、尾帧缓冲模拟、abort、Studio children、连续多 turn。记录浏览器 Network/console 与服务端 state 证据。不得用刷新作为通过条件。",
      "acceptance": [
        "最低自动检查全部通过",
        "远程反代下回复完成后自动恢复 Send",
        "重连仍 active 不闪回 Send",
        "同一 turn 无重复消息、回调或提示音",
        "UI 与批准 HTML 原型一致",
        "剩余多实例/网关限制已记录"
      ],
      "validation": [
        "npm run test:agent-sse-recovery",
        "npm run test:ypic-cli",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "git diff --check",
        "manual direct + reverse-proxy browser matrix"
      ],
      "risks": [
        "测试代理未复现生产缓冲策略",
        "浏览器/网关 idle timeout 差异",
        "多实例无粘性导致状态查询落到错误进程"
      ],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "groups": [
      { "id": "G0", "subtaskIds": ["UI-00"] },
      { "id": "G1", "subtaskIds": ["SSE-01", "FE-02"] },
      { "id": "G2", "subtaskIds": ["TEST-03", "DOC-04"] },
      { "id": "G3", "subtaskIds": ["CHECK-05"] }
    ]
  }
}
```

## 验证命令

```bash
npm run test:agent-sse-recovery
npm run test:ypic-cli
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

不直接运行 `next build`。本任务不是 release 验证；如后续需要 production bundle gate，只能使用 `npm run build`。

## 检查门禁

- UI designer HTML + 用户审批未完成：阻塞。
- idle snapshot 可能在 prompt preflight 前误清：阻塞。
- 使用顶层 wrapper `running` 代替 `state.isStreaming`：阻塞。
- 状态查询失败时猜测 idle：阻塞。
- Studio child count 被忽略：阻塞。
- 同一 turn 多次 `onAgentEnd`/提示音：阻塞。
- idle 时仍持续 polling：阻塞。
- 新 snapshot 泄露路径/内容/模型或 auth 信息：阻塞。
- 只验证直连、不验证真实反代：阻塞。
- 未更新核心 docs：阻塞。

## 回滚方案

- 首选分层回滚：先禁用前端 watchdog/reconcile，保留 anti-buffering headers。
- `connected.state` 是 additive，可安全保留；必要时再回退 snapshot projection。
- 无配置、JSONL、session/task 数据迁移，不需数据回滚。
