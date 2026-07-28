# Brief — GitHub 自动化 retry 空跑闭环

## 问题摘要

本任务修复的是 GitHub 自动化 durable job 的**运行时处理器就绪、Session bootstrap 失败归因、手动 retry/resume 闭环和真实验收口径**。它不是业务 Issue #22 的功能实现，也不能以 fixture 测试通过代替生产现场恢复。

用户已多次收到“已修复”的结论，但生产 #22 仍长期停在 `studio_task_ready`，调度次数约 900，Session 不存在。此次成功标准必须从“代码/测试看起来正确”提升为：**端口 30142 上的真实同 generation job 在一次 retry 后创建 WorkTree Session 并推进；任何 handler/bootstrap 失败都必须保留真实、安全、可核对的失败码，且失败时不得宣称修复。**

## 生产现场证据

### 用户提供的故障快照

- Job：`job_1278854433_22_g1_01a6cdde`
- Repository：`602362837/yolk-pi-web`，Issue `#22`
- 故障态：`phase=planning`、`checkpoint=studio_task_ready`、`status=retry_due`、`reason=runner_no_progress`
- `attempt=900`；`sessionId=null`；0.8.4 后 `noProgressRunCount=2`
- Runner：WorkTree 已存在；`taskId=20260727-094902-github-22-chat打开底部模型性能问题`；`spaceId=wt_b9a34ba5adde488f`；`sessionId=null`
- 当时 Studio task 仍为 `intake`，规划产物是占位内容
- WorkTree HEAD 曾为 `a8d2f6f`（0.8.2）；main 0.8.4 为 `69c79e0`
- 运行 provenance：0.8.4 / `ITdRXZIWZa15PXqlq8RhH`
- 首次真实策略拦截：`unattended_plan_policy_blocked / blocked_uncertain`（旧 policy 将标题“模型”误判）
- 随后约 898 次 `job_started` 自旋；0.8.4 改为 no-progress backoff 后仍没有 Session

### 本次规划期间的只读复核

只读检查本机 durable job、runner sidecar 与 safe events 后确认：

1. 同一 job 仍为 **generation 1**，`attempt=900`，WorkTree/task/branch/space 都被保留；当前已由 operator stop-bleed 暂停，未创建 g2。
2. 0.8.4 事件 `legacy_job_reconciled → unattended_retry_wake → job_started → job_no_progress_backoff` 出现两轮，之间没有 handler 产生的 `unattended_implementing`。
3. 后续一次诊断调用确实到达 `unattended_implementing`，紧接着出现：
   - `kind=unattended_session_bootstrap_failed`
   - `reasonCode=session_bootstrap_failed`
   - `meta.message="Internal GitHub automation error"`
4. 这证明两个问题同时存在：标准 Settings retry 路径可能未注册完整 handler；真正进入 bootstrap 后，根因又被通用安全投影折叠为无诊断价值的 generic message。

> 上述复核只读取 safe job/runner/event 数据；未 retry、未改 job、未启动实现、未改生产代码。

## 代码证据

### A. handler 注册缺口

- `lib/github-automation-runtime.ts` 的私有 `ensureGithubIssueTriageHandlerRegistered()` 只在 `acceptGithubAutomationWebhook()` 内调用。
- Settings action 路径为：
  `POST jobs/[jobId] → applyGithubAutomationJobAction → wakeGithubUnattendedJobForRetry → wakeGithubAutomationScheduler`。
- `lib/github-automation-projection.ts` 直接调用 scheduler wake，没有确保 `githubIssueTriageJobHandler` 已注册。
- scheduler 的 `_jobHandler` 进程启动时为 null；`defaultJobHandler` 对 `planning/studio_task_ready` 原样返回。
- `applyHandlerDisposition()` 随后只能将这个无进展结果归为 `runner_no_progress`。这与生产 0.8.4 事件序列完全一致。

### B. bootstrap 失败折叠

- `runGithubUnattendedImplementation()` 捕获 bootstrap error 后，先调用 `safeGithubAutomationErrorMessage()`。
- 该安全函数只允许既有固定消息；普通 SDK/jiti/fs error 会变成 `Internal GitHub automation error`。
- 代码随后在**已经折叠后的字符串**上用 `ENOENT|EACCES|timeout...` 正则判断 transient，因此真实错误类别无法可靠决定 retryability。
- transient 分支还会写 `status=queued` 并返回 `wakeAgain=true`，但没有显式 `disposition`；当 phase/checkpoint 未变时 scheduler 可能再次覆盖成 `runner_no_progress`。
- 现有测试主要手工构造 bootstrap-failed job projection，没有 fault-inject 实际 bootstrap catch → disposition → scheduler 的完整链路。

### C. 验收口径缺口

现有文档强调 #22 恢复是 operator 动作，focused tests 使用 temp agent dir + mocks。该边界对日常测试是正确的，但本次用户明确要求：**最终必须由 release candidate 进程在 `http://localhost:30142` 对真实 #22 或同形态生产 job 执行 pause → 单次 retry 并核对事件/API/Session。**

## 目标

1. 建立单一、幂等、可验证的 GitHub automation runtime readiness 入口。
2. webhook、job retry/resume、scheduler ensure/tick，以及未来 server boot 入口都不能在完整 handler 未就绪时处理业务 job。
3. handler 未就绪必须变成 `handler_not_ready`，绝不能借 default handler 伪装成 `runner_no_progress`。
4. Session bootstrap 使用 typed stage/code/retryability；safe event 保留固定安全诊断，不泄漏绝对路径、模块 specifier、stack 或 secret。
5. 已知 failure 返回显式 scheduler disposition，保持真实 reason，不被 no-progress 覆盖。
6. `attempt` 继续只表示 scheduler lease runs；Agent/meaningful progress 独立计数。
7. #22 恢复必须复用 g1、WorkTree、branch、Studio task、history 和 policy gate。
8. 最终在 30142 完成真实验收；自动测试只能作为前置条件。

## 非目标

- 不实现或修改 Issue #22 所述“chat 打开底部模型性能问题”。
- 不创建 g2、不删除历史、不重置 `attempt`、不跳过 plan/final policy。
- 不自动 merge/release/push main。
- 不新增 Jobs 页面布局、交互或状态结构。
- 不把 raw SDK/jiti error、模块路径、WorkTree 绝对路径、stack、credential 投到 API/UI/event。

## 成功定义

- 自动验证覆盖 handler cold-process retry、handler init fault、bootstrap fault/disposition、reason preservation、projection privacy 和 attempt semantics。
- 30142 的 release candidate provenance 可确认，且只由该进程处理验收 job。
- pause 后仅发出一次 retry。
- 真实事件至少出现 `unattended_retry_wake → job_started → unattended_implementing`，随后出现安全 `unattended_session_created`（或等价明确 Session-created 证据）。
- job projection 显示 `sessionAvailability=active|ended`、`agentRuns>=1`、runner `sessionId!=null`，Session header 绑定 WorkTree `projectId+spaceId`。
- `jobId`、`generation=1`、WorkTree、branch、task、history 保持；`attempt` 不重置，且不得重新出现连续 no-progress 空跑。
- 若结果为 `handler_not_ready`、任何 `session_bootstrap_*` 失败、`runner_no_progress`、无 Session 或 provenance 不匹配：记录证据、停止并报告，**不得宣称修复**。
