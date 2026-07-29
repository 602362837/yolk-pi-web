# PRD — 修复 GitHub 议题分析 handler readiness 与 durable retry

## 目标与背景

GitHub Issue #25 已被 webhook 正常入队，但停在 `received/retry_due/handler_not_ready`，且超过 `nextRetryAt` 后没有自动重试。目标是在不改变分析产品口径和 UI 的前提下，恢复单一 analysis handler 的生产可达性、durable retry 的到期执行和进程启动恢复。

## 用户价值

- 人类新建、允许且已启用的 Issue 能在后台可靠进入分析，不依赖第二个 webhook 或人工点 Retry。
- 自动重试时间真实可兑现；重启后 durable job 不会遗失。
- 未真正调用 handler 时不消耗业务 attempt，运维可以从安全事件判断实际阶段。

## 范围内

### R1 — 单一 production handler

Scheduler 必须直接调用 `githubIssueAnalysisJobHandler`；生产路径不得通过同步动态 require + registry 猜测 handler 是否就绪。

**验收：** Webpack production bundle 冷启动的第一个 v2 analysis job 不得进入 `default_handler_defensive_fallback`。

### R2 — Lease 前 readiness

如果 production handler 无法装载，job 不得取得业务 lease、不得写 `job_started`、不得增加 `attempt`。测试替身不得成为生产 fallback。

### R3 — Retry deadline 可兑现

`retry_due.nextRetryAt` 到期后，即使没有 webhook、API mutation、页面打开或人工 Retry，也必须重新参与调度。

### R4 — Timer 不丢失

多个 schedule 请求不得让 future-due job 在一次过早 tick 后永久失去 timer。调度器必须保存/重算最早的 durable wake deadline。

### R5 — 启动恢复

每个 Node server 进程启动后应安全 ensure scheduler，扫描 v2 analysis jobs，并恢复 overdue queued/retry_due/stale-running job。多进程仍由现有 filesystem lease/fence 去重。

### R6 — 暂停/禁用语义

`enabled=false` 或 `paused=true` 不执行 job；若存在未终态 job，scheduler 可做低频、无副作用的配置重检，以便恢复后继续。status/verify GET 仍不得 wake 或 enqueue。

### R7 — Checkpoint 与幂等不变

恢复 #25 或其他 job 时保留 phase/checkpoint/result/effects；不得重跑已验证 result sidecar，不得重复已 remote-confirmed 的评论/关闭。

### R8 — Ingress 不变

Webhook 继续快速返回 202；request thread 不运行模型、GitHub mutation 或证据分析。

### R9 — 安全日志

事件只记录固定 reason/diagnostic、attempt/deadline/phase 等安全字段；不得记录 raw error、stack、绝对路径、Issue body、prompt、token 或凭据。

### R10 — Production bundle 回归

必须有一个真正加载 `.next` production artifact 的 runtime smoke，不能只用 jiti 源码测试或静态正则替代。

### R11 — 确定性 scheduler 回归

使用可控 clock/timer 验证：future retry、过早 tick、timer 覆盖、idle 到期、startup recovery、pause/resume、no-spin 和 attempt 语义。

### R12 — 现有 UI 契约不变

最近分析继续显示 outcome、phase/status、attempt、reason、updatedAt、nextRetryAt 和 Retry；不新增或重排可见信息。

## 范围外

- 分析内容、模型选择、证据工具和预算。
- GitHub App 权限、webhook 签名和 allowlist。
- 评论/关闭策略。
- 新 UI、日志查看器、scheduler 控制按钮。
- 直接修写生产 job 数据。

## 验收场景

1. **冷 production bundle：**首个 retryable analysis job 被真实 handler 处理；reason 变为业务阶段结果，而非 `handler_not_ready`。
2. **future retry：**handler 返回 5 秒 retry_due，2 秒内发生一次 tick；5 秒到期后仍自动再次 lease。
3. **启动恢复：**预置已过期 retry_due job，启动 server，无 webhook/人工动作也会继续。
4. **不消耗假 attempt：**handler 初始化失败测试中 attempt 保持不变且没有 `job_started`。
5. **暂停：**暂停期间无 job lease；恢复配置后在 bounded 时间内继续。
6. **幂等：**result_ready/commenting/closing checkpoint 重试不重复已确认副作用。
7. **隐私：**job/event/API projection forbidden-key 扫描继续通过。

## 未决决策

- **D1（推荐批准）：**新版本启动后自动恢复 #25 等已有 `retryability=automatic` job，而不是要求人工 Retry。
- **D2（推荐批准）：**不做 UI 改版；过期时间在 scheduler 修复后恢复其真实含义。
- **D3（运维提醒）：**若不希望部署后 #25 立即分析并可能发布规范评论，应在升级前设置 `paused=true`；不要修改 job 文件。
