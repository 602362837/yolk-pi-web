# Brief — GitHub 议题分析 `handler_not_ready` 重试等待异常

## 结论

任务 `job_1278854433_25_g1_bf088aca` 不是 GitHub、模型、项目绑定或权限未就绪，而是 **0.8.10 生产 Webpack bundle 的 handler 冷加载竞态叠加 scheduler 定时器断链**：

1. webhook 正常接收并创建 `schemaVersion=2 / kind=issue_analysis` job；
2. scheduler 用同步 `require("./github-issue-analysis-runner")` 读取被 Webpack 编译为异步模块的 runner；首次读取发生在异步依赖完成前，异常被空 `catch` 吞掉，registry 仍为 `none`；
3. job 已先取得业务 lease、`attempt` 从 0 增为 1，随后落入 `defaultJobHandler`，写成 `received/retry_due/reason=handler_not_ready`；
4. fallback 安排 5 秒后重试，但 job 的 `.finally()` 又用 2 秒 poll 覆盖该 timer；2 秒 tick 时 job 尚未到期，tick 没有候选也没有续订 timer，scheduler 永久停摆；
5. 进程启动没有队列恢复入口，因此即使重启，已有 overdue job 也不会自行恢复，除非新 webhook 或人工 Retry 再次 wake。

这是三个相互放大的缺陷：**生产 handler 装载错误（主因）+ future retry timer 断链（直接造成长期等待）+ 启动恢复缺失（阻止重启自愈）**。

## 现场证据

### Job #25

- 数据文件：`~/.pi/agent/github-automation/jobs/job_1278854433_25_g1_bf088aca.json`
- `createdAt=2026-07-29T04:43:42.412Z`
- `phase=received`
- `status=retry_due`
- `attempt=1`
- `reasonCode=handler_not_ready`
- `nextRetryAt=2026-07-29T04:43:47.647Z`
- 检查时已超过 `nextRetryAt`，但 `updatedAt` 仍停在 `2026-07-29T04:43:42.661Z`。

### Durable event 时间线

1. `04:43:42.445 delivery_enqueued`
2. `04:43:42.635 job_started`，attempt=1
3. `04:43:42.647 github_automation_handler_not_ready`
4. diagnostic：`default_handler_defensive_fallback`
5. 此后没有第二次 `job_started`。

说明 ingress、durable enqueue、lease 都成功，失败发生在 scheduler 选择 production handler 之后；同时所谓“automatic retry”并未发生。

### 生产 bundle 证据

运行实例：全局安装 `@alan-zhao/yolk-pi-web@0.8.10`，Next server PID 58799，端口 30141。

`lib/github-automation-scheduler.ts:185-198` 的同步 require 在生产 bundle 中变成：

```js
let a=c(81309), b=a.githubIssueAnalysisJobHandler ?? a.handleGithubIssueAnalysisJob
```

而模块 81309 明确被包装为异步模块：

```js
81309:(a,b,c)=>{ c.a(a, async (...) => { ... await ... }) }
```

因此冷启动时 export getter 尚未完成初始化；异常或空 export 被 scheduler 的空 `catch` 吞掉。源代码 jiti 测试不是这一执行模型。

### 定时器证据

- fallback disposition：5 秒后的 `nextRetryAt`；
- `applyHandlerDisposition()` 调用 `scheduleGithubAutomationScheduler(delay)`；
- 随后 `runJobUnderLease(...).finally()` 无条件调用 `scheduleGithubAutomationScheduler(2000)`；
- `armTimer()` 会清除已有 timer；
- tick 对“无 runnable candidate”不安排后续 tick。

这精确解释了为什么只有一次 attempt，且时间停在 retry deadline 之前。

### 启动条件证据

`ensureGithubAutomationScheduler()` 只有 webhook enqueue 路径调用；不存在 `instrumentation.ts` 或其他 server-start bootstrap。`status` / `verify` 明确只读且不 wake，config PATCH 也明确不 wake。

### 测试缺口

`npm run test:github-automation` 当前全部通过（10 + 24 + 9 + 7 + 18），但：

- handler 测试直接传入 `runner.githubIssueAnalysisJobHandler`，没有测试无参冷加载；
- suite 通过 jiti 加载源码，不经过 Webpack async-module bundle；
- no-spin 测试关闭自动 timer，并手工连续调用 tick；
- 没有“future retry 到期后无需外部 wake 自动执行”测试；
- 没有“进程启动恢复 overdue durable job”测试。

## 影响

- 0.8.10 冷进程收到首个 Issue 时可稳定落入 `handler_not_ready`。
- `attempt` 被错误消耗，尽管真实 analysis handler 从未运行。
- UI/API 会诚实显示 `retry_due`、reason 和过期的“下次自动重试”，但无法判断 scheduler 已无 timer。
- 当前 job 未执行模型、未评论、未关闭 Issue；没有远端副作用。

## 修复范围

1. production scheduler 直接绑定单一 analysis handler，不再用同步动态 registry 冷加载。
2. production handler 未就绪时不得取得业务 lease或增加 attempt；default handler 只保留为显式测试替身，或删除生产可达路径。
3. scheduler 以 durable queue 的最早 deadline 续订 timer，不允许较晚/无关 timer 造成 due job 永久丢失。
4. Node server 启动时自动 ensure/reconcile；已有 overdue `retry_due` job 在部署新版本后可恢复。
5. 新增 source、fake-clock/timer、production-bundle runtime smoke；同步架构、library map、runbook。
6. 保持 webhook 202、status/verify 只读、retry checkpoint、UI布局和远端幂等门禁不变。

## 不在范围

- 不改 Issue 分析模型、证据预算、评论模板或关闭门禁。
- 不人工修改 #25 job 文件，不在规划阶段点击 Retry。
- 不新增 Settings 页面、按钮、弹窗、状态布局或 HTML 原型。
- 不重新引入旧 handler-runtime / triage / unattended graph。
