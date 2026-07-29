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
  - running：heartbeat/settlement 或 stale-running deadline；
  - blocked/completed/cancelled/ignored：不调度。
- job settlement 后触发一次 rescan，由 queue truth 决定下一 timer，不用互相覆盖的“disposition timer + finally poll timer”。

### 3.2 Server startup bootstrap

建议新增根级 `instrumentation.ts`：

- 仅 `NEXT_RUNTIME === "nodejs"` 时动态导入 scheduler 并调用 `ensureGithubAutomationScheduler()`；
- fire-and-forget，不阻塞 Next ready；
- Edge/build 路径不启动；
- 多进程每个进程可 ensure，filesystem job lease/fencing 保证只有一个执行副作用；
- 不读取或输出 secret。

启动 ensure 应扫描未终态 v2 analysis job：

- enabled/unpaused：按最早 deadline 调度；
- paused/disabled 且存在 pending job：低频重检配置，避免 config PATCH 直接 wake，保持 API route 的既有副作用说明；
- 无 pending job：停止 timer，等待 webhook wake。

### 3.3 `lib/github-issue-analysis-runner.ts`

- 保留 checkpoint、retry budget、comment/close gates。
- 将 scheduler handler 类型提取到 types 文件或使用结构兼容类型，避免为静态绑定制造 runtime circular import。
- 删除 runner 反向注册 convenience function，或确保仅 test/tooling 使用且不进入生产初始化。

### 3.4 Tests

新增两类证据：

1. **Deterministic source runtime test**：注入 fake clock/timer，覆盖 deadline/timer/startup/no-spin。
2. **Production artifact smoke**：先 `npm run build`，在 temp `PI_CODING_AGENT_DIR` 中加载 `.next` 的真实 jobs route，预置合法 config + retry_due v2 job，并用 malformed job repository name 让真实 handler 在联网前安全 block；断言不是 `handler_not_ready`，且 attempt/事件符合真实 handler 路径。

production smoke 必须执行 `.next` artifact；仅源码 import 或搜索 bundle 字符串不能作为验收。

## 4. 状态机契约

```text
received/queued
  → real handler lease (attempt +1)
  → analyzing/result_ready/commenting/closing/completed
  ↘ infra retry_due(nextRetryAt)
       → durable timer/startup reconcile
       → same first-unconfirmed checkpoint
```

Handler bootstrap failure：

```text
before lease: process/module readiness failure
  → no job_started
  → no attempt increment
  → safe process-level diagnostic / startup failure
```

不得再走：

```text
real job → default handler → handler_not_ready attempt
```

## 5. API / UI 契约

- Webhook、status、verify、jobs API body 不变。
- status/verify GET 继续不 wake。
- jobs Retry 继续 preserve phase/checkpoint/effects 并 wake。
- UI 继续使用现有字段；修复后 `nextRetryAt` 再次可信。
- 不新增 scheduler owner、timer handle、module error 或 stack 的 wire 字段。

## 6. 日志与隐私

- 保留 durable `job_started`、`issue_analysis_retry_due`、checkpoint/completed 事件。
- handler bootstrap 不再写到具体 job attempt；如需 startup diagnostic，只允许固定 code，例如 `analysis_handler_initialization_failed`，不得附 raw error/path/stack。
- timer 细节只通过测试 hook 观察，避免生产事件每 2 秒刷盘。

## 7. 兼容性与迁移

- 无 config/job schema 迁移。
- #25 原 job 保留 `phase=received/checkpoint=received/attempt=1` 审计历史；新版本启动后下一次真实 handler lease 变为 attempt=2。
- 不回写历史 event。
- 旧 result/effect sidecars 继续由 runner 验证并幂等恢复。

## 8. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 静态 import 拉大 route bundle或形成 cycle | 将 handler contract 移到 leaf types；production build smoke 验证 |
| startup 多进程重复执行 | 复用 filesystem lease + fencing；测试双 ensure |
| 自续 timer 形成 busy loop | 只按 durable deadline调度；fake clock验证 future/no-job/paused；保留 no-progress阈值 |
| config paused 后无法恢复 | pending job 低频配置重检，或经批准后由 config mutation wake；本方案优先前者以保持 route契约 |
| 部署后 #25 立即产生远端评论 | 运维不希望自动恢复时升级前设置 paused；不改 job 文件 |
| production smoke 意外联网 | 用 handler 在 GitHub/model调用前可确定 block 的 fixture，temp agentDir，禁止真实 endpoint |

## 9. 回滚

- 代码回滚到旧 scheduler 会重新暴露该缺陷，不建议作为运行回滚。
- 止血使用 `paused=true`，保留 jobs/events；不要删除 #25。
- 若 startup bootstrap 异常，可先禁用该 bootstrap，同时保留直接 handler + durable timer 修复，并要求人工 Retry 作为临时恢复。
