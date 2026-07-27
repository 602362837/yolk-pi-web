# Design：GitHub P1 无人值守闭环修复

## 方案摘要

把当前“job status + runner sidecar + command delivery + scheduler timer”松散组合改成一个**有进展凭证、一次性命令、可续租、可观测、可恢复**的 durable state machine。

核心不是让所有 `planning` 都创建 Session，而是让每一层都有真实语义：

```text
verified owner command (consume once)
  → start gates
  → WorkTree(projectId + spaceId)
  → Studio task ready
  → scope/policy plan gate (no Session is valid and visible)
  → implementing checkpoint
  → parent Session bootstrap + worktree index
  → full-agent child run (isolated scrubbed env)
  → validation
  → final actual-diff policy
  → server App publisher
  → PR open / terminal
```

任何一步只能：前进、等待、带退避重试、稳定阻塞或终止；不能无变化地回到立即 runnable queued。

## AS-IS 根因链

### RC-1：初始 plan empty-diff 错判

旧 `github-risk-policy.ts` 只允许 `stage=pre` 在 files=[] 时通过；runner 却在 Session 前执行 `stage=plan` 且主动传空 snapshot，于是落入 uncertain。`issueTitlePreview` 又被重复传成 `planText`，混淆了 untrusted title 与可信计划证据。

当前 `6b00e82` 已让 plan empty defer，但初始事件发生于旧 PID 89892；当前 PID 6140/0.8.3 bundle 已包含该修复。

### RC-2：retry 后 command replay 截断 runner

`githubIssueTriageJobHandler()` 在 active unattended phase 先调用 `runOwnerIntentIfPresent()`，后调用 `continueGithubUnattendedJob()`。job 的 `deliveryId` 仍指向 adoption comment；effect 已 `remote_confirmed` 时，idempotent replay 返回当前 job。scheduler 已先把它改为 `running`，所以该返回永远截断 runner continuation。

### RC-3：scheduler 把无进展放大成自旋

`runJobUnderLease()` 每次 `attempt+1` 并写 `job_started`。handler 返回后若 job 仍 `running`，scheduler 自动 park 为 `queued`；finally 无条件安排约 2 秒后的 tick。queued 立即 runnable，于是 checkpoint 不变而 attempt 激增。

### RC-4：Session 设计还有未触发的断链

WorkTree sync 实际产生 `spaceId=wt_…`，但 ensure result/runner sidecar 只保留 `projectId`。Session bootstrap 传 `{projectId, spaceId:undefined}`，违反 `agent-session-bootstrap.ts` 的成对约束并抛错。该错误当前被 runner 视为非致命；child 缺少 parent header 后也没有 project/space 可继承，WorkTree index 仍为空。

### RC-5：长任务 lease 与共享 env 不是闭环

- dir lease 60 秒后可被删，无 heartbeat/live PID/fencing；长 Agent run 可能在 5 分钟 stale-running reconcile 后重复执行。
- GitHub unattended Session/member path 从共享 `process.env` 删除 secret env；这会改变同一 Next 进程后续 webhook/publisher 的 effective credentials。它不是可靠的 per-Agent env 隔离。

### RC-6：safe projection/UI 丢失关键事实

当前 job wire 只有 phase/status/attempt/checkpoint/reason；不含 runner Session、task status、blocked layer、semantic progress、scheduler/lease、build provenance。UI 原样显示 `planning / running · 第 N 次`，因此把 scheduler lease 当作 Agent 工作。

## TO-BE 状态与数据契约

### 1. Job execution disposition

扩展 handler result（命名可在实现时按附近风格调整）：

```ts
type JobDisposition =
  | { kind: "progressed"; progressRevision: number; checkpoint: string }
  | { kind: "waiting"; wakeOn: "agent" | "external" | "timer" }
  | { kind: "retry_due"; reasonCode: string; nextRetryAt: string; retryClass: string }
  | { kind: "blocked"; reasonCode: string; layer: BlockedLayer; fingerprint: string }
  | { kind: "terminal"; status: "completed" | "cancelled" | "ignored" };
```

Scheduler 不再根据“handler 返回后仍 running”猜 queued。缺少 disposition 或 progressRevision 未变化时，记录 `runner_no_progress` 并退避；连续超过阈值稳定 block。

### 2. 计数与进展

旧 `attempt` 不迁移、不重写，兼容解释为 `schedulerRunCount`。新字段：

- `schedulerRunCount`
- `agentRunCount`：真正 bootstrap/child start 成功后加一
- `meaningfulProgressCount`
- `noProgressRunCount`
- `progressRevision`
- `lastMeaningfulProgressAt`
- `lastMeaningfulProgressKind`：固定 allowlist enum，不含自由文本

Meaningful progress 仅包括：checkpoint 前进、Session 创建、child run terminal、validation terminal、policy terminal、publisher terminal；scheduler heartbeat 不算。

### 3. Block / retry fingerprint

```text
sha256(layer | reasonCode | checkpoint | policyId/version | codeRevision |
       scopeFingerprint | bounded structured-input hash)
```

- deterministic policy/manual block：无 auto retry。
- operator retry：若 fingerprint 未变化，可直接返回 `retry_conditions_unchanged`；若 build/policy/input 已变，允许一次安全 checkpoint 重评。
- infra/runtime/network：指数退避 + jitter + cap；到阈值转 operator-visible block。

### 4. Owner command work item

保留 `deliveryId` 作 audit，但新增/派生一次性 command 状态：

```ts
pendingCommand?: {
  deliveryId: string;
  commentId: number;
  versionHash: string;
  commandKey: string;
  state: "pending" | "consumed";
}
```

流程：

1. ingress 只在新 exact comment/version 时设置 pending。
2. triage handler 消费一次并写 effect。
3. command terminal 后清 pending/标 consumed。
4. 后续 scheduler tick 不再读旧 comment；直接进入 unattended runner。
5. legacy job：若 current delivery 对应 remote_confirmed effect，reconcile 为 consumed 后继续。

`status`/`pause` 可使本 tick终止；`continue/adopt` 完成 side effect 后返回 queued/progressed，由下一阶段运行，不在同一 delivery replay。

### 5. Policy stage matrix

| Stage | 事实来源 | 空 files | title/hint | 结果用途 |
| --- | --- | --- | --- | --- |
| pre | config、claim、owner auth、structured scope hint | deferred | 仅 advisory/high-confidence block，记录 source | 决定是否建立 WorkTree/Studio |
| plan | runner-owned structured plan evidence + declared files/change kind/UI gate | deferred | 不把 title 复制成 planText | 决定是否进 implementing |
| final | actual Git diff + limits + structured validation/small-bugfix evidence | block empty | title 不覆盖 actual diff | 唯一 publish risk gate |

`GithubRiskPolicyResult` 可新增 `outcome=allow|block|defer`；若为兼容暂不扩 union，则保留 decision=allow 但必须有 `deferred=true/deferredReason`，UI/事件不能写 `allowed_docs`。

Hint classifier：

- 中文用显式 token/短语，不依赖 `\b`。
- “模型”单独无 secret/auth 含义。
- `issueTitlePreview` 与 `planText` 分别投影 `evidenceSource`。
- final 不使用 title hint 阻止安全 actual diff。
- UI 高置信 scope 得到 `blocked_manual_ui_approval`；最终 UI path 永远 block。

### 6. Runner checkpoint

保留现有 checkpoint 字符串兼容，增加 `blockedAtLayer`：

```text
start_gate | worktree | studio_task | policy_pre | policy_plan |
session_bootstrap | agent | validation | policy_final | publisher | lifecycle
```

`studio_task_ready → policy_plan → implementing` 只发生一次。进入 implementing 后先完成 parent Session bootstrap，再宣称 `agentExecutionState=active`。

`singleStep` 返回 `progressed` 且 revision 增加；否则不 `wakeAgain`。pause 在 checkpoint 前后检查；global pause 阻止新 lease。full-agent concurrency 仍为 1，并与 triage scheduler slots 分开计数。

### 7. Lease heartbeat + fencing

- lease owner 记录 `ownerId/pid/processEpoch/fencingToken/createdAt/heartbeatAt`。
- 活跃 handler 每 15 秒续租；job `leaseExpiresAt` 同步更新，但 heartbeat 不计 meaningful progress。
- stale remove 需要 heartbeat 过期，并检查同 host PID/epoch 不活跃；不能只看目录年龄。
- 每次 job/runner 写带 fencing token；旧 token 写入被拒。
- `markStaleRunningAsRetry()` 先跳过 process-local `inFlight`，再核对 lease。
- lease lost 时触发 AbortSignal，阻止旧 owner 继续 child/publisher。

### 8. WorkTree / Session / Studio 一致性

`GithubAutomationWorktreeEnsureResult` 与 runner state additive 增加 `spaceId`。新建与 reuse 都按 canonical path 从 Project Registry 解析实际 WorkTree space；`spaceSynced=false` 不等于没有 space，需 read-back。

Session invariant：

```text
runner.projectId/spaceId
  == parent JSONL header projectId/spaceId
  == child inherited projectId/spaceId
  == worktree .ypi/sessions/index.v1.json identity
```

- policy 前：sessionAvailability=none 是合法且可见。
- implementing：bootstrap 传 projectId+spaceId；成功后 sidecar 持久化 opaque sessionId/contextId/sessionFile（file 不上 wire）。
- bootstrap 失败：`retry_due(session_bootstrap_transient)` 或 `blocked_session_binding`；禁止静默继续。
- child header 继承 parent；Session lifecycle 写入 WorkTree index。
- main project space 不显示该 Session。

### 9. Agent env 隔离

共享 Next 进程不得删除/临时覆盖 `process.env`。推荐新增 GitHub unattended **isolated SDK host child process**：

1. parent 构造 `scrubGithubAutomationOwnedSecretsFromEnv(process.env)` 副本；
2. 仅把副本作为 child process env；
3. child 运行现有 SDK full-agent Session，继续写标准 child JSONL/transcript/task run；
4. IPC 只传固定 metadata/progress/result，不含 App/machine secret；
5. server publisher 仍在 parent，原 credentials 完整保留。

这只解决“产品不主动注入 env”的边界，不是 OS sandbox；same-user files/network residual risk 继续显示。

### 10. Safe projection

`GithubAutomationJobSafeProjection` additive：

```ts
schedulerState: "queued" | "leased" | "backoff" | "paused" | "idle" | "terminal" | "unknown";
agentExecutionState: "not_started" | "bootstrapping" | "implementing" | "checking" | "publishing" | "ended" | "failed" | "unknown";
sessionAvailability: "none" | "creating" | "active" | "ended" | "failed" | "unknown_legacy";
blockedAtLayer: BlockedLayer | null;
retryability: "automatic" | "operator_after_change" | "operator" | "none";
lastMeaningfulProgress: { at: string | null; kind: SafeProgressKind | null };
counts: { schedulerRuns: number; agentRuns: number; noProgressRuns: number };
workspaceLabel: string | null;
runtimeProvenance: { packageVersion: string; buildId: string; codeRevision: string; processEpoch: string; processStartedAt: string; policyVersion: string };
evaluatedProvenance?: { codeRevision: string; policyVersion: string };
```

不返回 worktreePath/sessionFile/absolute path/正文/prompt/transcript/tool payload。短 session id 是否显示取决于安全审查；本次 UI 只要求 availability。

### 11. UI 数据流

```text
GET /api/github-automation/status (no-store, read-only)
  → server safe derived projection
  → GithubAutomationConfig
      → Agent status + Scheduler status
      → summary / rail / facts
      → existing actions[]
POST jobs/:id retry|pause|resume
  → server state gate + reconcile
  → refresh projection
```

前端不从 raw phase/status 推断 Agent active；unknown 保守显示“状态未知/尚无可证实 Agent 活动”。详情可显示 raw phase/status/legacy attempt，但必须解释口径。

原型与完整状态见 [ui.md](ui.md) / [HTML](github-unattended-job-observability-prototype.html)。

## 当前 #22 处置策略

### 修复部署前

1. per-job pause；必要时 global pause。
2. 保留 job/events/g1 WorkTree/branch/task；不 retry、不改 JSON。
3. 记录当前 legacy attempt 仅作 scheduler-run 审计。

### 修复部署后

1. 完整停止并重启 `ypi`；status 确认新的 package/build/code/policy provenance。
2. 幂等 reconcile：
   - adoption command effect → consumed；
   - 解析 `projectId+spaceId`；
   - checkpoint 仍恢复 `studio_task_ready`；
   - `sessionAvailability=none`；
   - block/retry fingerprint 使用新版本。
3. operator 单次 retry。
4. 预期有限状态：
   - policy 明确阻断 → stable blocked，无 Session；或
   - implementing → parent Session 创建并出现在 WorkTree space → child implementer。
5. 不自动建 g2；publisher/PR 幂等仍按原 g1。

不提供 manual unblock/skip gate。手工将 task 改 implementing 或伪造 session 均禁止。

## 兼容性与迁移

- Job/runner/task/JSONL/index 均 additive schema；旧记录不重写。
- 缺新字段时 projection 显示 `unknown_legacy`，不能假 active。
- `attempt` 保留；新 UI 改名调度尝试。
- runner sidecar新增 `spaceId`，旧 sidecar在 reconcile/read 时按 canonical WorkTree path 查 registry。
- existing block 的 provenance 缺失时标 legacy；需 operator retry，不自动唤醒。
- API 新字段 additive，旧客户端继续消费原字段。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| title hint 放松导致 UI 任务晚拦 | pre 高置信 hint + plan structured UI gate + final UI path 三层；保留 residual side-effect 警告 |
| command migration 漏新命令 | pending command exact version + effect 双证据；新/旧 fixture |
| lease fencing 破坏旧写者 | additive token；旧 schema只读降级；所有写路径集中封装 |
| isolated SDK host 改变取消/usage | 复用现有 child JSONL/run/transcript/progress contract；IPC allowlist；专门回归 |
| UI 暴露本机信息 | workspace label 由 server生成；禁止 paths/content；forbidden-key/sentinel tests |
| #22 恢复重复副作用 | same generation/worktree/run/PR idempotency；reconcile 与 retry 分离；单次 operator action |
| code fix 未被运行进程加载 | runtime/evaluated provenance 对比；production 必须完整重启 |

## 回滚

1. Ops：`paused=true` 或 `unattended.enabled=false`，保留 triage/audit。
2. UI：隐藏 additive detail，回退旧卡片但保留后端 no-spin/backoff；不得恢复“第 N 次=Agent”。
3. Auto retry：将 recoverable retry 统一停为 operator block；不可恢复 queued 自旋。
4. Isolated runner：停用 unattended Agent，回到 `accepted_waiting_automation`；不可回退到共享 process.env 删除。
5. 数据：不删新 additive 字段/sidecar/events；旧版本忽略未知字段。
