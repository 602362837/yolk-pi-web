# Design — GitHub 自动化 handler/bootstrap/retry 闭环

## 1. 方案摘要

修复分为三层：

1. **Runtime readiness**：scheduler registry 成为权威；任何 tick/ensure/wake/action/webhook 在业务处理前都要确认完整 handler 已注册。default handler 不再能静默接管生产 planning job。
2. **Typed bootstrap outcome**：Session 创建链路在未 sanitize 前分类 stage/code/retryability；runner 对已知结果返回显式 disposition，scheduler 不得重写成 `runner_no_progress`。
3. **Release acceptance**：自动测试只做前置；最终由 30142 release candidate 对真实 g1 job 做单次 retry，证明 Session 创建。

不引入新 UI 结构；使用现有 dual-layer projection。

## 2. AS-IS 根因

### 2.1 handler lifecycle 与 scheduler lifecycle 分离

```text
webhook
  └─ private ensureGithubIssueTriageHandlerRegistered()
      └─ registerGithubIssueTriageHandler()
          └─ setGithubAutomationJobHandler(full handler)

Settings retry/resume
  └─ applyGithubAutomationJobAction()
      └─ wakeGithubUnattendedJobForRetry()
      └─ wakeGithubAutomationScheduler()   # 未注册 handler

scheduler tick
  └─ getGithubAutomationJobHandler()
      └─ null ? defaultJobHandler : full handler
```

重启后没有 webhook 时，Settings retry 只唤醒 timer。planning job 进入 default handler，原样返回，随后成为 `runner_no_progress`。

### 2.2 bootstrap 分类顺序错误

```text
raw SDK/jiti/fs error
  → safeGithubAutomationErrorMessage()
  → "Internal GitHub automation error"
  → regex 判断 ENOENT/EACCES/timeout  # 已丢根因
  → queued/blocked + 无 disposition
  → scheduler 可能覆盖 runner_no_progress
```

生产 safe event 已证实 generic message。

## 3. TO-BE 架构

### 3.1 单一 handler registry/readiness

建议将 readiness 权威放在 `lib/github-automation-scheduler.ts` 的 registry 边界，并用独立小模块承载可测试的 bootstrap 状态（最终文件名可由实现员按避免循环依赖选择，例如 `lib/github-automation-handler-runtime.ts`）。

建议契约：

```ts
type GithubAutomationHandlerRuntimeState =
  | { kind: "ready"; handlerKind: "github_issue_triage"; generation: number }
  | {
      kind: "not_ready";
      reasonCode: "handler_not_ready";
      stage: "load" | "register" | "verify";
      retryability: "automatic" | "operator";
    };

async function ensureGithubAutomationJobHandlerReady(): Promise<...>;
```

关键规则：

- 不能用 runtime 模块私有 `_triageHandlerRegistered` 布尔值作为真相；它会和 scheduler reset/HMR 脱节。
- registry 记录 `handlerKind`/generation；`registerGithubIssueTriageHandler()` 幂等设置固定 kind。
- 并发 ensure 共享 process-global promise；失败后按安全退避允许下一次重试，不永久缓存 rejected promise。
- 动态 import 可避免 scheduler ↔ triage runner 静态循环；verify 必须发生在 timer/tick 处理 job 前。
- custom handler 测试必须有显式 test override；生产不能误把 custom/default 标为 ready。

### 3.2 所有入口的调用顺序

```text
webhook accept
  → ensure store
  → ensure handler ready
  → verify/enqueue
  → scheduler wake

manual retry/resume
  → load + gate + reconcile
  → ensure handler ready
  → mutate queued/retry state
  → scheduler wake

ensure/wake/tick
  → tick 内最终 ensure handler ready
  → only ready: list candidates → lease → attempt++ → full handler
  → not ready: no business lease; safe handler_not_ready outcome/event
```

`tick` 自身必须是最后一道防线：即便未来 server boot 直接 ensure scheduler，也不会漏注册。当前仓库没有独立 server boot auto-ensure；如果实现增加 instrumentation/startup，只允许调用相同 readiness/scheduler ensure，不得再注册一套 handler。

### 3.3 handler_not_ready 语义

- 主 reason：`handler_not_ready`
- blocked layer：`scheduler`
- Session：`none`
- Agent：`not_started` 或现有 `failed`（必须保守，绝不能 implementing）
- attempt：不增加，因为未取得业务 lease
- event：`github_automation_handler_not_ready`
- safe meta：`stage`、`retryability`、`handlerKindExpected`、固定 `diagnosticCode`
- 禁止 meta：raw import specifier、absolute path、stack、cause text、secret
- 自动型失败用 process-level capped backoff；operator 型（bundle/module missing）稳定阻断。相同 processEpoch/stage/code 事件去重，避免风暴。

`defaultJobHandler` 可以继续服务 GHA-02 隔离测试，但 production readiness 开启时不得用于业务 job。若防线异常落入 default 且 phase 不是 `received`，也必须返回明确 `handler_not_ready` disposition，不能原样返回。

## 4. Session bootstrap error contract

### 4.1 typed error

扩展 `AgentSessionBootstrapError` 或增加 GitHub 专用 mapper，使分类发生在 raw cause 仍存在时：

```ts
interface SessionBootstrapFailure {
  reasonCode: "session_bootstrap_failed" | "session_bootstrap_transient";
  bootstrapCode:
    | "session_binding_invalid"
    | "session_worktree_missing"
    | "session_project_space_missing_or_archived"
    | "session_project_space_mismatch"
    | "session_runtime_module_missing"
    | "session_runtime_start_failed"
    | "session_index_update_failed"
    | "session_unknown";
  stage: "binding" | "runtime_load" | "runtime_start" | "index";
  retryability: "automatic" | "operator";
  safeMessage: string; // fixed allowlist only
}
```

分类依据优先级：

1. 项目自有 typed error code；
2. Node error `code`（从 cause chain 取，不输出 message）；
3. 固定 stage fallback；
4. 永不解析 sanitize 后的自由文本。

`MODULE_NOT_FOUND` 归为 `session_runtime_module_missing`，operator 修复/重启；event 不透露缺失模块名或 build-host 路径。`ENOENT/EACCES/EBUSY/EAGAIN` 是否 automatic 由 stage 决定，不能一律重试。

### 4.2 partial Session 与清理

`createConfiguredEmptyAgentSession()` 可能在 `startRpcSession` 成功后，于 project link/index 更新失败。实现必须明确：

- 若 wrapper/session 已创建但 bootstrap 整体失败，优先 destroy/dispose 临时 wrapper并保留 JSONL审计；不得留下 live wrapper 却报告 Session 不存在。
- 若 Session 已达到可用边界，只把 index write-through 作为现有 best-effort 生命周期处理；不要因为 candidate index 次要失败撤销 JSONL truth。
- 具体边界需由实现员根据 `upsertProjectSpaceSessionFromFile` 现有 fail-soft 约束做最小调整，并用测试锁定。

### 4.3 runner 持久化与 disposition

成功：

1. 写 runner `sessionId/contextId/sessionFile`。
2. `agentRunCount += 1`（保持现有口径）。
3. `progressRevision += 1`、`meaningfulProgressCount += 1`、`lastMeaningfulProgressKind=session_created`。
4. append `unattended_session_created` safe event；wire 仅 short id/flags。

失败：

- automatic：job `phase=implementing`、checkpoint 保持 `session_bootstrap` 或可恢复 implementing、`status=retry_due`、`nextRetryAt`，返回 `disposition.kind=retry_due`。
- operator：job stable blocked，`blockedAtLayer=session_bootstrap`，返回 `disposition.kind=blocked`。
- runner sidecar 保留 g1/WorkTree/task/project/space，`sessionId=null`，记录稳定 `reasonCode`。
- append `unattended_session_bootstrap_failed` with allowlisted typed meta。

显式 disposition 是防折叠关键；不能依赖 scheduler 从 `queued/running` 猜测。

## 5. Known failures 的 disposition 审计

实现时对 `continueGithubUnattendedJob()` 可达的停止分支做审计：

| Outcome | Disposition |
| --- | --- |
| handler_not_ready | retry_due 或 blocked（scheduler layer） |
| incomplete_claim | blocked（start_gate） |
| policy plan/final block | blocked（对应 policy layer） |
| session bootstrap transient | retry_due（session） |
| session bootstrap hard | blocked（session_bootstrap） |
| implementer runtime recoverable | retry_due（runtime） |
| waiting external/paused | waiting |
| PR/completed | terminal |

`runner_no_progress` 只保留为**未知 handler bug 的兜底**，不是已知错误的公共 reason。

## 6. 数据与兼容性

### 不迁移

- job JSON、runner sidecar、events、Session JSONL 不做批量迁移。
- 历史 `attempt=900` 原样保留。
- 旧 job 缺 additive 字段时继续保守投影。

### 同 generation

- retry 仍先 `reconcileGithubAutomationLegacyJob()`。
- generation/jobId/branch/WorkTree/task/effects/events 不变。
- 不跳 policy，不新建 g2，不扫描历史评论重新授权。

### Wire/UI

不新增状态 union或页面结构。主 job reason 使用已有字符串字段；typed细分类只进 safe event meta/server logs（固定 allowlist）。现有 `blockedAtLayer/sessionAvailability/agentExecutionState` 足以呈现。

若实现必须新增 wire/UI 字段或文案，立即触发 UI 原型门禁，不得顺手扩展。

## 7. 测试设计

### Handler tests

- reset scheduler/registry，禁用 webhook；manual retry 后 assert handler kind 为 full triage，planning job到达 unattended continuation。
- 并发 ensure 只注册一次。
- 动态 import/register/verify fault injection → `handler_not_ready`；attempt 不增加；没有 `runner_no_progress`。
- direct scheduler ensure/tick 也受保护。

### Bootstrap tests

通过窄依赖注入/test override 让实际 runner catch 分别抛 typed：module missing、binding mismatch、transient runtime、unknown hard error。

断言：

- job reason/layer/status/nextRetryAt；
- returned disposition；
- scheduler apply 后 reason 不变；
- safe event meta allowlist；
- projection 不含 path/specifier/stack；
- success event、runner session、counts/progress。

### #22 shape regression

使用 temp agent dir 复刻 g1/attempt=900/studio_task_ready/remote_confirmed/spaceId/session null，执行**真实 action→readiness→scheduler→runner**链路，而不是自定义 no-op handler。断言 finite ticks、无 default handler、无 g2、attempt不重置。

## 8. 30142 真实数据流

```text
RC build
  → stop/隔离其他共享 agent-dir ypi process
  → node bin/pi-web.js --port 30142 --no-open
  → GET health + status provenance
  → GET #22 job baseline / safe events baseline
  → ensure per-job paused
  → POST retry exactly once to :30142
  → poll job/status + inspect safe events
  → verify Session JSONL header projectId+spaceId
  → immediate pause after success evidence
```

不得依赖 HTTP 301/302 跳转来“证明”30142；health/status/job 请求必须直接由 30142 PID 响应。

## 9. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 动态 import 循环/HMR 导致假 ready | registry kind+generation verify；process-global single-flight；direct tick test |
| handler init fault形成新自旋 | lease 前失败；attempt不增；event去重+backoff |
| raw error泄密 | typed code/stage 固定映射；sentinel/path/specifier断言 |
| transient仍被 no-progress覆盖 | 所有已知失败显式 disposition |
| Session 创建后 index failure留下孤儿 | 明确JSONL truth/cleanup边界并测试 |
| 30141与30142竞争导致归因错误 | 真实验收前隔离其他共享 agent-dir scheduler；核对PID/processEpoch |
| #22 agent继续处理业务需求 | Session成功证据后立即 per-job pause；不审/合并业务diff |
| policy真实阻断 | 不跳过；验收失败并报告，必要时改用用户允许的同形态生产 job |

## 10. 回滚

- 回滚 readiness/typed mapper/disposition 代码，不改任何 durable 历史数据。
- stop-bleed 始终可 per-job pause 或 global paused。
- 回滚后保留新增 safe events；未知旧版本会忽略 additive event meta。
- 不删除 #22 WorkTree/task/session/events，不恢复 attempt。
