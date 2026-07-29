# 排查 GitHub 议题自动分析 handler_not_ready 重试等待异常

- Task: 20260729-124623-排查-github-议题自动分析-handler_not_ready-重试等待异常
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260729-124623-排查-github-议题自动分析-handler_not_ready-重试等待异常
- Archived at: 2026-07-29T10:03:13.968Z
- Tags: studio, feature-dev

## Summary
已修复 GitHub 议题自动分析 `handler_not_ready` 与 retry_due 卡住问题：production handler 直接绑定、durable retry deadline/timer 重构、Node startup reconcile、真实 `.next` production smoke 与文档更新均完成。全部 focused tests、lint、tsc、build、production smoke、diff-check 通过。未提交代码，未部署，未对真实 Issue #25 执行 Retry/comment/close。

## Reusable knowledge
### summary.md

# Summary

已修复 GitHub 议题自动分析 `handler_not_ready` 与 retry_due 卡住问题：production handler 直接绑定、durable retry deadline/timer 重构、Node startup reconcile、真实 `.next` production smoke 与文档更新均完成。全部 focused tests、lint、tsc、build、production smoke、diff-check 通过。未提交代码，未部署，未对真实 Issue #25 执行 Retry/comment/close。

### handoff.md

# Handoff — architect

## 已完成

- 读取 GitHub automation architecture/integration/API/frontend/library/runbook 与相关 scheduler/runtime/runner/store/projection/UI 代码。
- 只读核对运行中的全局 `0.8.10` production bundle、#25 job、安全事件和 status API。
- 确认三段根因：Webpack async runner 被同步 require、retry timer 被提前 poll 覆盖后断链、server startup无queue恢复。
- 产出 [brief.md](brief.md)、[prd.md](prd.md)、[ui.md](ui.md)、[design.md](design.md)、[implement.md](implement.md)、[checks.md](checks.md)、[plan-review.md](plan-review.md)。
- 未修改生产代码、未修改job、未点击Retry、未commit/push/merge。

## 已运行验证

- `npm run test:github-automation`：全部通过（10 + 24 + 9 + 7 + 18）。
- 只读 production bundle 检查确认 scheduler同步读取模块81309，而81309由Webpack `c.a(... async ...)` 包装。
- 现场event确认只有一次attempt，之后没有自动重试。

## 主会话需要决定

1. 是否批准部署后startup自动恢复 #25（推荐批准）。
2. 若不希望立即产生GitHub评论，是否在升级前先全局暂停。
3. 批准后保存implementationPlan并进入awaiting_approval；不要在审批前实现。

## 剩余风险

- production bundle行为无法由当前jiti源码suite覆盖；必须新增并运行真实`.next` smoke。
- startup多进程必须继续依赖filesystem lease/fence去重。
- 自动恢复#25可能立刻触发真实分析与规范评论；关闭仍受现有严格门禁。
- 若实现扩展到UI变化，当前“无需原型”结论失效，必须补ui-designer HTML原型审批。

### review.md

# Review

## Verdict
PASS

## Evidence
- `npm run test:github-automation`: GIA-01 10、GIA-02 24、GIA-03 11、GIA-04 7、GIA-07 27 全部通过。
- `npm run lint`: 0 errors，只有既有 warnings。
- `node_modules/.bin/tsc --noEmit`: 通过。
- `npm run build`: 通过，仅既有 webpack warnings。
- `npm run test:github-automation-production-runtime`: 真实 `.next` route smoke 通过，`status=blocked`、`reason=malformed_full_name`、`attempt=2`、`networkAttempts=0`。
- `git diff --check`: 通过。
- HNR-START-07 已补充为独立 Node 进程、不同 owner、共享 durable storage 的 lease/fence 竞争测试。

## Scope
HNR-01~04 已完成；未修改 UI、未提交 commit/push/merge，未操作真实 Issue #25。

### checks.md

# Checks — handler readiness / retry / startup recovery

## 1. 需求覆盖

- [ ] Production scheduler 直接绑定唯一 analysis handler。
- [ ] 冷启动首 job 不进入 default fallback。
- [ ] Handler 未初始化时零 lease、零 `job_started`、零 attempt 增量。
- [ ] `retry_due.nextRetryAt` 无外部 wake 也能到期执行。
- [ ] 过早 tick 不会吞掉 future deadline。
- [ ] server startup 自动恢复 overdue v2 analysis job。
- [ ] paused/disabled 不执行，恢复后 bounded 继续。
- [ ] result/effect checkpoint 幂等不变。
- [ ] status/verify GET 仍为零 scheduler side effect。
- [ ] UI/API现有字段和布局不变。

## 2. 自动化测试矩阵

| ID | 场景 | 必须证明 |
| --- | --- | --- |
| HNR-COLD-01 | Webpack production bundle 首次加载 runner | 首次执行真实 handler；无 `handler_not_ready` |
| HNR-LEASE-02 | production handler 初始化失败 fixture | attempt不变，无job_started |
| HNR-TIMER-03 | 5s retry + 2s early tick | 5s到期后再次lease，无外部wake |
| HNR-TIMER-04 | 较晚schedule请求覆盖较早deadline | 最早deadline保留 |
| HNR-IDLE-05 | tick时只有future retry | timer持续存在直到due |
| HNR-START-06 | server启动前已有overdue retry_due | 启动ensure后继续 |
| HNR-START-07 | 两个process/ensure竞争同job | filesystem lease/fence只执行一次 |
| HNR-PAUSE-08 | pending job + paused→unpaused | paused零lease，恢复后bounded继续 |
| HNR-NOSPIN-09 | handler no-progress/retry budget | 无立即queued spin，backoff/blocked保持 |
| HNR-CKPT-10 | result_ready/comment remote-confirmed | 不重跑模型/不重复评论关闭 |
| HNR-READ-11 | status/verify polling | 不启动scheduler、不改job |
| HNR-PRIV-12 | events/job/API递归扫描 | 无body/prompt/path/token/stack/raw error |

## 3. Production artifact smoke 门禁

1. 使用 `npm run build`（不得直接 `next build`）。
2. 以 temp `PI_CODING_AGENT_DIR` 准备 enabled v2 config 和 retry_due v2 job。
3. 加载 `.next/server/app/api/github-automation/jobs/[jobId]/route.js` 的真实 POST route 并触发 Retry。
4. Fixture 必须在任何真实 GitHub/model网络调用前由真实 handler 确定性结束。
5. 轮询 temp job，断言：
   - `attempt` 增加一次；
   - reason 不是 `handler_not_ready`；

### design.md

# Design — GitHub analysis handler 与 durable scheduler 修复

## 1. 方案摘要

采用三层修复：

1. **Handler boundary：**production scheduler 静态、直接绑定唯一 `githubIssueAnalysisJobHandler`，移除生产可达的同步动态 require/default fallback；测试注入保留为显式 test-only override。
2. **Durable scheduling：**timer 由 durable queue 的最早可运行 deadline 驱动；每次 tick / job settlement 后重算下一 wake，任何过早 tick 都不能让 future retry 失去后继 timer。
3. **Process lifecycle：**Node server 启动时 ensure scheduler；已有 overdue job 在新版本启动后自动恢复，现有 lease/fence 负责多进程去重。

UI、webhook、analysis checkpoint 和远端幂等门禁保持不变。

## 2. AS-IS 根因链

### 2.1 Handler 冷加载竞态

```text
webhook wake
  → prewarm() 同步 require runner
  → Webpack runner 是 async module
  → export getter 尚未初始化 / 为空
  → catch 吞掉
  → registry none
  → tick 仍允许 lease
  → getHandler() 返回 default
  → attempt +1, handler_not_ready
```

文档已经规定“single handler directly / no dynamic production registry”，实际代码偏离该边界。

### 2.2 Retry timer 断链

```text
fallback sets nextRetryAt = now + 5s
  → disposition schedules +5s
  → job finally schedules +2s and clears +5s timer
  → +2s tick: job not due
  → no candidate, no next timer
  → overdue forever
```

### 2.3 启动恢复缺失

Scheduler 只在 webhook enqueue 或人工 Retry 被 wake；server startup 不扫描 durable queue。重启不会修复已存在的 #25。

## 3. TO-BE 模块边界

### 3.1 `lib/github-automation-scheduler.ts`

- production path 直接引用 runner handler；不通过 no-arg dynamic `require` 注册。
- registry 若保留，只服务测试 override；`defaultJobHandler` 不得被 production tick 选中。
- production handler boundary 在任何 business lease 前确定。
- `attempt` 只表示真实 handler lease-run，不记录 handler bootstrap 失败。
- scheduler state 增加内部 `nextWakeAtMs`（仅 test snapshot 可见，不进入普通 API）。
- timer helper 使用最早 deadline 语义；同一 timer 的较晚请求不得覆盖较早请求，显式 immediate wake 可提前。
- tick 根据 job 状态计算下一 deadline：
  - queued：立即/短延迟；
  - retry_due：`max(now, nextRetryAt)`；
  - running：

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
