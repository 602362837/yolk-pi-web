# PRD — 修复 GitHub 自动化手动 retry 空跑

## 1. 目标与背景

GitHub 自动化 Settings 的 retry/resume 应恢复同一 durable job，但生产 #22 在 0.8.4 仍表现为 `studio_task_ready → runner_no_progress`，`attempt≈900` 且没有 Session。一次非标准诊断路径虽进入 implementing，却将 Session bootstrap 根因折叠为 `Internal GitHub automation error`。

本任务要交付一个可证明的闭环：完整 handler 必须在任何调度入口前就绪；bootstrap 失败必须分类并保留；最终由 30142 上的真实进程和真实 job 证明 Session 能启动。用户已经多次收到“修复完成”但现场未恢复，因此**测试绿不是完成条件**。

## 2. 用户价值

- Operator 点击一次 retry 后，系统要么真实推进到 Session/Agent，要么明确说明停在哪个 runtime/bootstrap 层。
- Operator 不再用 `runner_no_progress` 猜测 handler、policy、Session、jiti 或路径错误。
- 历史 `attempt=900` 仍作为调度审计存在，但不会被误读为 Agent 跑了 900 次。
- #22 的 g1/WorkTree/task/history 可安全恢复，不用删除现场或新建 generation。

## 3. 范围内

1. GitHub automation handler 注册/readiness 单一入口。
2. webhook、manual retry/resume、scheduler ensure/tick、未来 server boot 的 readiness 闭环。
3. `handler_not_ready` 的安全 job/event/API 表达。
4. Session bootstrap typed errors、stage、retryability、safe event 和显式 disposition。
5. reasonCode 在 scheduler 后处理中的保真。
6. focused/integration fault-injection tests。
7. docs/runbook 与 30142 验收脚本/记录模板。
8. 真实 #22 或同形态生产 job 的 pause → 单次 retry 验收。

## 4. 范围外

- Issue #22 的业务需求（chat 打开底部模型性能问题）本身。
- 绕过 `docs-and-small-bugfix` policy，或把 UI issue 强行归为可无人值守。
- 新建 g2、重写/删除 job/events/task、删除 WorkTree、重置 attempt。
- 新的 Jobs UI 组件、布局、操作或 wire 状态结构。
- 自动 merge、release、main push。

## 5. 硬约束

1. **不是测试绿就算修好。** 用户已多次被告知“已修复”，生产 #22 仍卡在 `studio_task_ready / runner_no_progress / attempt≈900 / Session 不存在`。
2. 最终验收必须在用户分配的端口 **30142**（`http://localhost:30142`）上完成。
3. 必须使用真实 #22 或同形态生产 job；禁止只靠 `npm run test:github-automation`、其他 fixture 或 temp agent dir 结案。
4. 业务 Issue #22 不在实现范围；只修自动化闭环、可观测性和 retry 路径。
5. 最终失败、无 Session、端口/provenance 不可信时不得宣称修复。

## 6. 需求与验收标准

### R1 — 单一权威 runtime readiness

**需求**：提供一个幂等、并发安全、可验证的入口，负责注册完整 `githubIssueTriageJobHandler` 并确认 scheduler registry 不再是 default handler。

**验收**：

- cold process 并发调用只完成一次有效初始化；后续调用无副作用。
- HMR/module reset 后不能仅相信旧布尔值，必须核对当前 registry generation/kind。
- readiness 失败返回 typed `handler_not_ready`，不执行 job lease。

### R2 — 所有业务入口均受 readiness 保护

**需求**：webhook、retry、resume、scheduler ensure/tick 必须经过 R1。若未来增加 server boot auto-ensure，只能调用同一入口。

**验收**：

- manual retry 在没有任何新 webhook 的重启进程中仍能注册完整 handler。
- `tickGithubAutomationScheduler()` 自身是最后一道保护，直接 tick 也不能让生产 job落入 default handler。
- default handler 仅保留隔离测试/兼容用途，生产业务 job 不可静默使用。

### R3 — handler 未就绪可见且 no-spin

**需求**：handler import/register/verify 失败时，job/event/API 使用 `handler_not_ready`，并给出 allowlisted stage/category；不得产生 `runner_no_progress`。

**验收**：

- 不增加 scheduler `attempt`（没有取得业务 lease 就不是 lease run）。
- event 不含 module specifier、绝对路径、stack、secret。
- job projection 保守显示 Session 不存在、blocked layer 为 scheduler；不得显示 Agent active。
- readiness 重试有去重/退避，不能形成 event 或 timer 风暴。

### R4 — Session bootstrap typed failure

**需求**：在 bootstrap 边界保留固定 stage/code/retryability，不再从已经 sanitize 的 generic message 反推错误。

**至少覆盖**：

- `session_binding_invalid`
- `session_worktree_missing`
- `session_project_space_missing_or_archived`
- `session_project_space_mismatch`
- `session_runtime_module_missing`
- `session_runtime_start_failed`
- `session_index_update_failed`（若发生于创建后，需说明 partial session 清理/保留策略）

**验收**：

- job 主 reason 仍使用稳定 `session_bootstrap_failed` 或 `session_bootstrap_transient`；safe event meta 额外给出 allowlisted `bootstrapCode`、`stage`、`retryable` 和固定 safe message。
- 不返回 raw `MODULE_NOT_FOUND` specifier、路径或 stack。
- retryability 来自 typed error/cause code，不从 generic 文案正则猜测。

### R5 — 显式 disposition 保留真实失败

**需求**：所有已知 handler/bootstrap/claim/policy failure 都必须返回 `blocked` 或 `retry_due` disposition；scheduler 不得用 `runner_no_progress` 覆盖。

**验收**：

- transient bootstrap：`status=retry_due`、`nextRetryAt`、`blockedAtLayer=session_bootstrap`、reason 保留。
- hard bootstrap：stable blocked，reason 保留。
- `handler_not_ready`、`incomplete_claim`、policy block 各自保持原 reason。
- 只有 handler 真正未给 disposition且 progress 未变化时才允许 `runner_no_progress`。

### R6 — Session 创建成功有正向证据

**需求**：成功 bootstrap 后写一条不含路径的 safe event，并更新独立计数/进展。

**验收**：

- event 如 `unattended_session_created`，meta 仅含 opaque/short session evidence、project/space binding flags，不含 sessionFile/path。
- runner sidecar 保存真实 `sessionId/contextId/sessionFile`（server-only）；wire 只投影 short id。
- `progressRevision`、`meaningfulProgressCount`、`lastMeaningfulProgressKind=session_created` 前进。

### R7 — attempt 语义不变

**需求**：`attempt` 永远是 scheduler lease-run count；Agent run 和 meaningful progress 分开。

**验收**：

- retry/reconcile 不重置或改写历史 attempt。
- handler readiness 在 lease 前失败不增加 attempt。
- Session 成功后 `agentRunCount` 按现有口径增加；heartbeat/timer 不算 meaningful progress。
- UI 继续显示“调度尝试 N”，不称为 Agent 执行次数。

### R8 — #22 同 generation 恢复

**需求**：真实恢复必须复用 `job_1278854433_22_g1_01a6cdde` 的 g1、WorkTree、branch、task、space、events。

**验收**：

- 不创建 g2；不删除 history；不修改 owner authorization 语义。
- retry 前仍执行幂等 legacy reconcile。
- 不跳过 plan/final policy；策略若真实阻断则明确失败并停止。
- 不把 Issue #22 的业务修改作为本任务代码范围。

### R9 — 现有 UI 结构复用

**需求**：服务器使用现有 `reasonCode / blockedAtLayer / sessionAvailability / agentExecutionState / counts` 结构表达结果。

**验收**：

- bootstrap hard fail：现有 Jobs 卡显示 Session 失败、阻塞层 Session 启动、稳定 reason。
- handler fail：现有卡显示 Session 不存在、阻塞层调度、`handler_not_ready`。
- 不新增页面、控件、状态结构或确认交互；如实现发现必须改这些内容，必须停止并补派 UI 设计员产出 HTML 原型，重新请求用户批准。

### R10 — 自动测试前置门禁

**需求**：增加真实控制流 fault injection，而不是只构造最终 projection fixture。

**验收**：

- cold retry without webhook → complete handler。
- handler import/register fault → `handler_not_ready`，0 lease attempt。
- bootstrap typed transient/hard fault → reason/disposition 保留。
- scheduler 后处理不折叠。
- same-generation、attempt、privacy、no-spin 回归通过。
- `npm run lint`、`node_modules/.bin/tsc --noEmit` 通过。

### R11 — 30142 真实验收

**需求**：release candidate 必须在 30142 监听并独占本次 job 处理，执行 pause → 单次 retry。

**验收**：

- `lsof`/health/status 证明监听 PID、版本、processEpoch、codeRevision 属于本次 RC。
- 共享 agent dir 的其他 ypi scheduler 已停用或退出，不能把成功归因给 30141/旧进程。
- baseline 后仅 POST 一次 retry。
- 事件序列至少：`unattended_retry_wake → job_started → unattended_implementing`；成功还必须有 Session-created 正向证据。
- status API、single-job API、safe events、runner sidecar、Session header 互相一致。
- 若出现 `handler_not_ready`、明确 bootstrap failure、`runner_no_progress`、无 Session、provenance 不匹配或 g2，验收失败，**不得宣称修复**。

## 7. 未决问题

无需要猜测的产品决策。实现阶段只需 operator 在最终验收前确认：

1. 优先使用真实 #22；若其业务 policy/状态已不适合单次恢复，选择哪个“同形态生产 job”。
2. 为确保 30142 归因，何时停止/隔离当前 30141 进程。
3. 验收成功见到 Session 后是否立即 per-job pause，避免本任务继续处理 #22 的业务 diff（推荐：立即 pause，保留全部审计）。
