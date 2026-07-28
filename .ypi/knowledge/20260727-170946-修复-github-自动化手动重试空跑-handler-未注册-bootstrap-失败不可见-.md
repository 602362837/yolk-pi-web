# 修复 GitHub 自动化手动重试空跑：handler 未注册 + bootstrap 失败不可见 + 30142 真实验收

- Task: 20260727-125847-修复-github-自动化手动重试空跑-handler-未注册-bootstrap-失败不可见-
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260727-125847-修复-github-自动化手动重试空跑-handler-未注册-bootstrap-失败不可见-
- Archived at: 2026-07-27T09:09:46.353Z
- Tags: studio, feature-dev

## Summary
## Current status - Workflow: `feature-dev` - Task: `20260727-125847-修复-github-自动化手动重试空跑-handler-未注册-bootstrap-失败不可见-` - Subtask **GHR-06**: **done / PASS** (real 30142 Session-created evidence) - GHR-01…05 remain implemented; production async-module load gap closed in this rework - No commit / push / merge - **User 30141 ypi left running** (PID 16545; never killed) ## What was done in this rework ### A. Production root-cause fix `lib/github-automation-handler-runtime.ts` - Load path prefers dynamic `import()`, always awaits thenable namespaces from import/require (Next webpack async modules). - Named-export interop: direct / getter / default / thenable export values. - Fallback: call `registerGithubIssueTriageHandler()` then verify live registry kind=`github_issue_triage`. - Diagnostics stay allowlisted (`handler_module_export_missing` / `handler_module_load_failed`); no path/specifier…

## Reusable knowledge
### handoff.md

# Handoff — GHR-06 PASS (rework); 30141 protected

## Current status

- Workflow: `feature-dev`
- Task: `20260727-125847-修复-github-自动化手动重试空跑-handler-未注册-bootstrap-失败不可见-`
- Subtask **GHR-06**: **done / PASS** (real 30142 Session-created evidence)
- GHR-01…05 remain implemented; production async-module load gap closed in this rework
- No commit / push / merge
- **User 30141 ypi left running** (PID 16545; never killed)

## What was done in this rework

### A. Production root-cause fix

`lib/github-automation-handler-runtime.ts`

- Load path prefers dynamic `import()`, always awaits thenable namespaces from import/require (Next webpack async modules).
- Named-export interop: direct / getter / default / thenable export values.
- Fallback: call `registerGithubIssueTriageHandler()` then verify live registry kind=`github_issue_triage`.
- Diagnostics stay allowlisted (`handler_module_export_missing` / `handler_module_load_failed`); no path/specifier/stack.
- Test hooks: `_testSetGithubAutomationHandlerModuleLoader` / `_testModuleLoader`.

### B. Offline regression

`scripts/test-github-handler-runtime.mjs`

- thenable webpack-like namespace settles to ready
- register-only export path registers via live registry
- incomplete namespace still not_ready export_missing (never no-progress)

`scripts/verify-github-automation-30142.mjs`

- pause detection uses phase/schedulerState/status (not only `status===paused`)
- `already_paused` treated as success for pause actions

### C. Real 30142 acceptance

1. `npm run build` → BUILD_ID `Yc4X_1B0Snpiv_Frv88V9`
2. Confirmed 30141 PID 16545; did not stop it
3. Started `node bin/pi-web.js --port 30142 --no-open` → next-server PID **21307**
4. Single retry harness (after pause-gate fix)
5. **PASS**: Session active, agentRuns=1, generation 1, at

### review.md

# review — integrated checker (strict)

## Verdict

**Pass** for the scoped regression class:

> GitHub automation **manual retry empty-run** caused by **handler not ready on cold process** + **invisible/generic bootstrap failure** + missing **30142 real Session proof**.

**Not in scope / not claimed fixed:** Issue #22 business work（chat 打开底部模型性能问题）. Post-Session `implementer_error` is residual, outside this gate.

---

## Checker report (checks.md §6)

```text
30142: PASS
PID/processEpoch/codeRevision: 21307 / pe-21307-ms2vfgr2 / 0.8.4/Yc4X_1B0Snpiv_Frv88V9#b9e4050ab1
Job/generation: job_1278854433_22_g1_01a6cdde / g1
Attempt baseline → final: 900 → 901
Events: unattended_retry_wake → job_started → unattended_implementing → unattended_session_created
Session availability / agentRuns: active (sessionId non-null) / 1
Same WT/branch/task/history: PASS
Post-proof pause: PASS (phase=paused, status=paused, checkpoint=implementing)
30141 protected: PASS (PID 16545 still LISTEN on 30141; never killed by this task)
Focused tests/lint/tsc: handler-runtime 9/9; session-bootstrap 8/8; unattended-runner 20/20; publish-policy 28/28; tsc clean; lint 0 errors
Blockers: none for empty-run / handler-not-ready / invisible-bootstrap class
Conclusion: PASS — may claim only this regression fixed; not Issue #22 business completion
```

---

## Findings Fixed

None by this checker pass. Implementation already includes:

1. **GHR-01 readiness authority** — `lib/github-automation-handler-runtime.ts` is process-global single-flight; scheduler registry kind=`github_issue_triage` + generation is live truth; webhook / Settings retry-resume / ensure-wake / tick all gate on `ensureGithubAutomationJobHandlerReady()`; lease-before-attempt; `handler_not_ready` without attempt increment; default handler

### checks.md

# Checks — handler/bootstrap/retry + 30142 真实验收

## 0. 完成判定（硬门禁）

本任务不能以 lint、typecheck 或 GitHub automation fixture 全绿结案。完成必须同时满足：

1. 自动验证全部通过；
2. release candidate 在 **http://localhost:30142** 直接监听；
3. 使用真实 #22 或同形态生产 job；
4. pause → **只发一次 retry**；
5. 同 g1 创建真实 WorkTree Session 并推进；
6. status API、single-job API、safe events、runner、Session header 一致；
7. 失败、无 Session、provenance 不匹配或只靠 fixture 时，**不得宣称修复**。

业务 Issue #22 本身不在本任务实现范围；验收只证明自动化闭环。

## 1. 需求覆盖检查

| ID | 检查项 | 必须证据 |
| --- | --- | --- |
| C1 | handler 单一权威入口 | registry kind/generation + cold retry test |
| C2 | webhook/retry/resume/ensure/tick 全覆盖 | source audit + integration tests |
| C3 | default handler 不处理生产 planning job | fault test 无 `runner_no_progress` |
| C4 | handler_not_ready 可见 | job/event/projection，attempt不增 |
| C5 | bootstrap typed failure | stage/code/retryability + fixed safe message |
| C6 | known failure 显式 disposition | scheduler 后 reason 不被覆盖 |
| C7 | attempt 语义 | retry不重置；lease前失败不增加；Agent独立计数 |
| C8 | same generation | jobId/generation/WT/branch/task/history 保留 |
| C9 | 不跳 policy | 无 skip action；policy block原样停 |
| C10 | UI 结构不变 | 仅现有 fields；无 component/CSS 变更 |
| C11 | 30142 真实验收 | PID/provenance + 一次 retry + Session evidence |

## 2. 自动验证

### 2.1 Handler registration / action chain

- [ ] cold process/reset registry 后，不发送 webhook。
- [ ] 对 planning/studio_task_ready job 调 `applyGithubAutomationJobAction(retry)`。
- [ ] action 在 mutate/wake 前确认 full handler ready。
- [ ] direct `ensureGithubAutomationScheduler` / `tickGithubAutomationScheduler` 同样确认 readiness。
- [ ] 并发 ensure single-flight；handler kind/generation可验证。
- [ ] HMR/reset 后不被旧 `_triageHandlerRegistered` 布尔值骗过。
- [ ] default handler 测试只能通过显式 test override 进入。

### 2.2 Handler failure

- [ ] load/register/verify 三类 fault 至少覆盖两类。

### design.md

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
      kind: "not_ready"

### implement.md

# Implement — GitHub automation retry/runtime/bootstrap

## 1. 执行原则

- 用户批准 [plan-review.md](plan-review.md) 前不得改生产代码。
- 先并行完成 handler readiness 与 bootstrap typed outcome；再做完整控制流测试。
- 自动测试、lint、tsc 只是 30142 真实验收的前置门禁，不是结案条件。
- 不修改 Issue #22 业务功能，不创建 g2，不删 history，不重置 attempt，不跳 policy。
- 不 commit、push、merge；server publisher 不在本任务验收中触发。

## 2. 实现前优先阅读

| 顺序 | 文件 | 重点 |
| --- | --- | --- |
| 1 | [brief.md](brief.md)、[prd.md](prd.md)、[design.md](design.md)、[checks.md](checks.md) | 现场证据、契约、最终门禁 |
| 2 | `lib/github-automation-runtime.ts` | webhook-only handler ensure |
| 3 | `lib/github-automation-scheduler.ts` | registry/default/tick/disposition/attempt |
| 4 | `lib/github-issue-triage-runner.ts` | full handler/continuation/registration |
| 5 | `lib/github-automation-projection.ts`、`app/api/github-automation/jobs/[jobId]/route.ts` | manual action + safe projection |
| 6 | `lib/github-automation-runner.ts` | bootstrap catch、retry、same-generation reconcile |
| 7 | `lib/github-automation-session.ts`、`lib/agent-session-bootstrap.ts`、`lib/rpc-manager.ts` | Session create 与 error boundary |
| 8 | `lib/github-automation-types.ts`、`lib/github-automation-store.ts` | disposition/observability/persistence |
| 9 | GitHub automation focused scripts | test harness 与 privacy sentinel |
| 10 | `docs/architecture/overview.md`、`docs/operations/troubleshooting.md`、`docs/modules/{api,frontend,library}.md` | 文档不漂移 |

## 3. 人类可读子任务表

| ID | Phase | 标题 | dependsOn | 并行/评审 |
| --- | --- | --- | --- | --- |
| GHR-01 | runtime | handler registry/readiness 与所有入口闭环 | — | 可与 02 并行；checker local review |
| GHR-02 | bootstrap | typed bootstrap error、显式 disposition、success event | — | 可与 01 并行；checker local review |
| GHR-03 | tests | action→scheduler→runner fault injection 与 #22-shape回归 | 01,02 | 串行整合 |

## Source artifacts
- handoff.md
- review.md
- checks.md
- design.md
- implement.md
- prd.md
- brief.md
- ui.md
- plan-review.md
