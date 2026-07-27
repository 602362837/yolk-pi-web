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
npm run test:github-automation
npm run test:github-unattended
npm run test:github-unattended-runner
npm run test:github-publish-policy
npm run test:project-space-session-index
npm run test:studio-sdk-runner
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

### 新增必测矩阵

#### Policy

- `stage=plan, files=[], title="chat打开底部模型性能问题"` → deferred/非 secret block。
- `stage=pre, title="修改 Settings 页面交互"` → UI/manual block。
- `stage=final, docs diff, title 含 OAuth` → 由 actual docs diff 决定，不被 title 覆盖。
- `stage=final, files=[]` → `blocked_empty_diff`。
- UI/workflow/release/auth/dependency/infra/binary/over-limit actual diff 均 block。

#### Command + scheduler

- 现场 job shape：`planning/studio_task_ready/retry_wake` + adoption effect remote_confirmed。
- 连续 20 tick：command side effect=1；runner 最多有限 tick 前进；无 20 个 `job_started`。
- handler 无 disposition/无 revision 变化 → backoff/blocked，不 queued。
- conditions unchanged manual retry → stable reason，不启动 Agent。
- restart 后 pending/consumed command 可恢复。

#### Lease

- fake clock 10 分钟 child run，heartbeat 正常：第二 scheduler 不接管。
- heartbeat 丢失 + owner dead：新 fencing token 接管；旧 owner write/publish 被拒。
- process-local inFlight 不被 stale reconcile 改为 retry_due。
- pause/global pause 与 lease lost AbortSignal 无竞态重复发布。

#### Session / Studio / WorkTree

- WorkTree create/reuse 都 read-back `spaceId`。
- 传 projectId 无 spaceId 必须在 runner 层被预防并得到可观察 blocker。
- parent Session header/link/index 一致；child 继承；main space list 排除。
- bootstrap transient fail → retry_due；binding mismatch → deterministic block。
- no parent Session 时 child 不得宣称 linked/active。

#### Env / security

- full-agent child env 无 `YPI_GITHUB_APP_*`、GH/GITHUB token sentinels。
- child 前后 parent `process.env` 与 effective credential projection 不变。
- task/job/runner/events/JSONL/projection/UI 无 secret sentinel。
- wire 无 `worktreePath/sessionFile/absolutePath/prompt/transcript/tool payload/Issue body/comment body`。

#### Projection / UI

- no session + policy block → `agentExecutionState=not_started`、`sessionAvailability=none`。
- scheduler lease active 但无 Agent → UI 仅写调度中。
- implementing/checking/publishing/terminal 双层状态正确。
- legacy 缺字段 → unknown_legacy，不猜 active。
- stale snapshot mutation disabled。
- 375/390px 无页面横向滚动；阶段轨道可局部滚动。
- 键盘展开、筛选、确认/取消、焦点恢复、状态非颜色单通道、reduced motion。

## 人工验收

### #22 现场恢复

1. 确认 job 已 pause，attempt 不再增长。
2. 完整重启后确认 status 的 build/code/policy provenance 是修复版。
3. reconcile 前后检查：同 jobId/generation/worktree/branch/task，无新 g2。
4. 单次 retry。
5. 预期二选一：
   - policy/manual block：稳定，无 auto retry，UI 显示无 Session；
   - implementing：parent Session 出现在 `ypi-gha-…-issue-22-g1` WorkTree space，task 进入 implementing，child run 可审计。
6. 不得出现：queued/running 每 2 秒抖动、attempt 快速增长、无 Session 却显示实现中。

### UI 原型一致性

以 [HTML 原型](github-unattended-job-observability-prototype.html) 为审批基线，逐态比对 #22 blocked、backoff、implementing、checking/publishing、terminal、loading/empty/stale、窄屏和明暗主题。

## 重点回归风险

- 新 command delivery 被 legacy consumed 逻辑误跳过。
- 自动 retry 被过度收紧，真正网络失败无法恢复。
- lease heartbeat 本身被算 meaningful progress，掩盖无进展。
- fencing token 未覆盖 runner/job/publisher 全部写路径。
- Session 创建成功但 index 异步失败，UI只看 sidecar误称可见。
- isolated SDK host 丢失 cancel、usage、transcript 或 task run terminal 写入。
- build provenance 只显示 package version，仍无法区分相同版本不同 build。
- final policy 继续受 title hint 影响，安全 docs diff 被误阻断。

## 当前规划阶段验证结果

- `npm run test:github-publish-policy`：**24 passed, 0 failed**；证明当前 0.8.3 已包含 empty plan + #22 title 回归。
- `npm run test:github-unattended`：**18 passed, 1 failed**；失败为 `permission_missing and installation_missing block without fallback identity`，实际得到 `implementer_error`。这是实现前必须定位并修复/更新 fixture 的现存红灯，不能忽略。
- 现场只读 `GET /api/github-automation/status`：#22 当时 `phase=planning,status=queued,attempt=279,checkpoint=studio_task_ready,reason=retry_wake`，pause available、retry unavailable。
- repo/global installed package 均 0.8.3，Next BUILD_ID 相同且 bundle 含 empty-plan fix；当前 spin 不是未安装该修复。
- UI 设计员原型 HTML/JS 语法自检通过；仍等待用户视觉/交互审批。

## 最终停止条件

出现以下任一情况必须停止，不得继续实现/发布：

- UI 原型未获用户明确批准。
- policy stage 或 deterministic/retryable 语义仍有产品歧义。
- child env 隔离只能通过共享 `process.env` 删除实现。
- lease fencing 无法覆盖 publisher 前最后一次写。
- 任一 GitHub focused suite、lint、tsc、security sentinel 未通过。
- #22 恢复需要手工跳过 policy、改 task/job JSON 或新建 generation。
