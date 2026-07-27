# GitHub 无人值守实现卡在 planning 空转：无 session、plan policy 误拦、调度自旋与可观测性闭环

- Task: 20260727-104502-github-无人值守实现卡在-planning-空转-无-session-plan-polic
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260727-104502-github-无人值守实现卡在-planning-空转-无-session-plan-polic
- Archived at: 2026-07-27T04:28:48.815Z
- Tags: studio, feature-dev

## Summary
规划已完成，task 已进入 `awaiting_approval`，生产实现尚未开始。 审批入口：[plan-review.md](plan-review.md)。 必须先批准：[HTML 原型](github-unattended-job-observability-prototype.html)。 完整修复覆盖 policy、command/state machine、scheduler/lease、Session/WorkTree/env、safe projection/UI、#22 recovery 与回归测试；禁止仅改正则或手工解锁 job。

## Reusable knowledge
### summary.md

# Summary

规划已完成，task 已进入 `awaiting_approval`，生产实现尚未开始。

审批入口：[plan-review.md](plan-review.md)。

必须先批准：[HTML 原型](github-unattended-job-observability-prototype.html)。

完整修复覆盖 policy、command/state machine、scheduler/lease、Session/WorkTree/env、safe projection/UI、#22 recovery 与回归测试；禁止仅改正则或手工解锁 job。

### handoff.md

# Architect / Implementer Handoff — GHA-CLOSE-08

## Status

- **Subtask:** GHA-CLOSE-08 (文档、回滚与最终门禁)
- **Result:** done (docs + final verification)
- **Production code in this subtask:** none (documentation/navigation only)
- **No** `commit` / `push` / `merge`

## Files Changed (this subtask)

| Path | Summary |
| --- | --- |
| `docs/architecture/overview.md` | Expanded P1 unattended: disposition no-spin SM, counts, command once, policy stages, WorkTree Session binding, env copy isolation, lease fencing, runtime provenance, #22 same-generation recovery |
| `docs/integrations/README.md` | P1 observability/disposition/recovery section; key modules + test matrix; layered rollback without history rewrite |
| `docs/integrations/github-app-automation-setup.md` | Operator #22 FAQ + table: dual-layer UI, full restart, reconcile, `retry_conditions_unchanged`, doc cross-links |
| `docs/modules/api.md` | Status/jobs safe projection, provenance, command fall-through, legacy reconcile on retry, test suite list |
| `docs/modules/library.md` | Scheduler disposition/fencing; worktree spaceId; session scrubbed env copy; automation invariants + tests |
| `docs/operations/troubleshooting.md` | Test matrix + architecture/setup cross-links (runbook already present from GHA-CLOSE-05) |
| `AGENTS.md` | Navigation only: disposition/lease/Jobs UI/reconcile + provenance/troubleshoot pointers; `test:github-unattended-runner` |

Already accurate from earlier subtasks (no edit required this pass):

- `docs/modules/frontend.md` — Jobs dual-layer UI (GHA-CLOSE-06)
- `docs/operations/troubleshooting.md` — full #22 stop-bleed / recovery section (GHA-CLOSE-05)

## Validation

| Command | Result |
| --- | --- |
| `npm run test:github-automation` | **113 passed / 0 failed** |
| `npm run test:github-unatt

### review.md

# Review：GitHub 无人值守 planning 空转闭环（GHA-CLOSE-01…08）

**Checker:** 检查员  
**At:** 2026-07-27  
**Scope:** 全计划 8/8 子任务终验（非局部 subtask）  
**Verdict:** **Pass**（可进入 review / 用户验收；不阻塞回 implementing）

---

## Check Complete

### Findings Fixed

- None（本轮仅审查与复跑验证，未改生产代码）

### Remaining Findings

#### 非阻塞

1. **真实浏览器 390px / 明暗主题手工 smoke 未在本机 UI 跑完**  
   证据：GHA-CLOSE-06/07 报告；以源码 + `GHA-CLOSE-07 Jobs UI source` 契约测试替代。建议 operator 在 Settings Jobs 做一次窄屏目视。

2. **#22 现场恢复仍是 operator 动作**  
   代码与 runbook 已具备；本任务边界不自动 pause/retry 生产 job。部署后需：pause → 完整重启 → `runtimeProvenance` → 单次 retry。

3. **env 隔离实现为 scrubbed env copy + bash `spawnHook`，非独立 SDK host 子进程**  
   满足 PRD R13「隔离子进程**或等价** per-run env」；架构文档已写清「非 OS sandbox」。同用户磁盘 residual risk 仍明示。

4. **runner 部分路径仍主要返回 `wakeAgain`，显式 `disposition` 由 scheduler 保守推导**  
   `applyHandlerDisposition` + no-progress 测试覆盖 #22 自旋根因；非必须返工。

#### 阻塞

- **None**

### Root-cause closure matrix

| 根因 | 实现证据 | 测试证据 |
| --- | --- | --- |
| RC-1 空 plan 误拦 / title≠planText | `github-risk-policy` pre/plan empty → `defer`；runner `planText: null` + `issueTitlePreview` 分离 | publish-policy: empty plan defer、「模型」非 secret、UI title block |
| RC-2 remote_confirmed 截断 runner | `runOwnerIntentIfPresent` active phase → `return null` fall-through + `pendingCommand` consumed | GHA-CLOSE-02 fallthrough；CLOSE-05 pre-schema consume once |
| RC-3 scheduler 无进展自旋 | `applyHandlerDisposition`：无 disposition/无 progress → `retry_due`/`runner_no_progress`，禁止立即 queued | GHA-CLOSE-02 no-progress；CLOSE-07 #22 finite ticks |
| RC-4 spaceId / Session 绑定 | worktree ensure 返回 `spaceId`；bootstrap 成对强制；失败可见 blocker | unattended-runner spaceId/bootstrap pair；CLOSE-07 bootstrap projection |
| RC-5 lease / env | lease heartbeat+fencing；scrubbed copy，不删共享 `process.env` | CLOSE-02 fencing

### checks.md

# Checks：GitHub P1 planning 空转闭环

## 需求覆盖检查

| 检查项 | 通过标准 | 证据 |
| --- | --- | --- |
| Policy stage | pre/plan/final 来源和空 diff 语义不同；final 只信 actual diff | table-driven tests + policy projection |
| 中文/title 误报 | “模型”不命中 secret；title 不复制为 planText | #22 fixture |
| UI gate | 高置信 UI scope/manual HTML gate 与 final UI path 均 fail closed | policy + Studio authorization tests |
| Command consume | 同 comment version side effect 一次；active job 后续直接 runner continuation | owner command replay test |
| No-spin | 同 checkpoint/no progress 不会立即 queued；有 backoff 或 stable block | fake-clock 20 tick test |
| Attempt 口径 | UI 显示调度尝试；Agent runs/无进展独立 | projection/UI tests |
| Retry 语义 | deterministic block 条件未变不重跑；infra retry 有 cap/backoff | fingerprint/backoff tests |
| Pause/global pause | per-job 与 global 互不混淆；global pause 不可由评论清除 | scheduler/owner command tests |
| singleStep | 仅 checkpoint 前进才 wake | restart/singleStep tests |
| Concurrency/lease | full-agent=1；长 run heartbeat；fencing 拒绝旧 owner | 双进程故障注入 |
| Session bootstrap | projectId+spaceId 成对；失败可见且不伪 active | session bootstrap tests |
| WorkTree 归属 | parent/child header/index 属于 WT space，main 不显示 | project-space session tests |
| Env isolation | server process env 不变；child env 无 App/machine secret | sentinel/env preserve tests |
| Safe projection | block layer/session availability/progress/build 可见，无 path/content/secret | forbidden-key tests |
| UI truthfulness | 无 Session 明确“尚未启动 Agent”；不显示“第 N 次执行” | HTML approval + browser smoke |
| Build provenance | installed package/build/process/policy 可对比；重启影响可见 | production smoke |
| #22 recovery | pause→deploy/restart→reconcile→单次 retry；复用 g1 | sanitized E2E |
| Publisher invariants | Agent 无 server publisher，不 push/PR；App 同仓 PR；无 auto-merge | publish policy tests |

## 自动验证

```bash
np

### design.md

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

WorkTree sync 实际产生 `spaceId=wt_…`，但 ensure result/runner sidecar 只保留 `projectId`。Session bootstrap 传 `{projectId, spaceId:undefined}`，违反 `agent-session-bootstrap.ts` 的成对约束并抛错。该错误当前被 runner 视为非致命；child 缺少 parent header 后也没有 project/space

## Source artifacts
- summary.md
- handoff.md
- review.md
- checks.md
- design.md
- implement.md
- prd.md
- brief.md
- ui.md
- plan-review.md
