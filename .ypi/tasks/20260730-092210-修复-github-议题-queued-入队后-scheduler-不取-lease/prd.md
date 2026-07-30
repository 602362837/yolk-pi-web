# PRD：修复 GitHub 议题入队后 scheduler 不取 lease

## 目标与背景

0.8.11 生产包中，Next.js 将 `instrumentation` 与 webhook route 编译为不同 bundle。两份 scheduler 模块共享 `globalThis` registry/state，却各自持有不同的 `githubIssueAnalysisJobHandler` 函数对象。webhook wake 接管共享 timer 后，当前 readiness 通过严格函数引用比较判断 production handler，导致检查恒为 false；tick 在扫描 job、获取 lease 前返回，因此新议题长期停在 `queued / attempt=0 / leaseOwner=null`。

本任务以已确认的真实生产证据为基线，恢复 `issues.opened → enqueue → wake → lease → job_started → analysis` 链路，并补齐能够覆盖真实 Next 双入口编译形态的发布回归门禁。

## 用户价值

- 新建且符合规则的 GitHub Issue 不再“已入队但永不分析”。
- 重启后 durable scheduler 与 webhook wake 可以共存，不因 bundle 切分改变业务语义。
- 线上 #26 的死亡进程 lease 通过既有 stale-running、lease stale、PID 与 fencing 门禁自动恢复，不要求操作员破坏性修改 job/lock。

## 范围内

1. 修改 `lib/github-automation-scheduler.ts` 的 production readiness：production 身份使用跨 bundle 稳定的注册 kind 语义，不比较函数对象身份。
2. 保留当前 bundle 的静态 `githubIssueAnalysisJobHandler` 为 production 实际执行 handler。
3. 保留 test-only `custom` handler 与 `productionReadinessDisabled` 行为。
4. 增加源码 focused 回归，模拟全局 registry 保存“另一 bundle”的 production handler 引用。
5. 扩展 production bundle smoke，按真实 `instrumentation → webhook route` 顺序加载 `.next` 入口，通过真实签名 webhook 入队并验证 lease/`job_started`。
6. 在临时 agentDir 中验证 `running + 死亡 PID + stale lease` 的安全自动恢复，覆盖 stale-running reconcile、重新取 lease、attempt/fencing/event 变化。
7. 制定 #26 发布后只读观察与自动恢复 UAT；禁止直接删除真实 lock 或手改真实 job。
8. 更新直接相关的 architecture/library/integration/test/troubleshooting 文档。

## 范围外

- 不修改 webhook ingress matrix、status/verify/retry API、job schema、lease store 算法、分析 handler、评论/关闭策略或并发配置。
- 不新增配置开关、数据库/文件迁移、后台管理操作或手工“强制解锁”能力。
- 不删除或重写真实 #26 job、lock、event、delivery。
- 不处理 GitHub Issue 本身的产品结论，不创建 PR，不发布版本。
- 不修改页面、组件、文案、信息结构或审批体验。

## 需求与验收标准

### R1：production readiness 跨 bundle 稳定

- `registration.kind === "production"` 且 test-only disable 未开启时，readiness 必须为 true；不得要求 registry 中的 handler 与当前 bundle 静态 handler 引用相等。
- production 执行时必须继续由当前 bundle 本地静态 `githubIssueAnalysisJobHandler` 提供 handler，不执行 registry 中可能来自另一 bundle 的 production 函数引用。

**验收：** 源码测试向共享 registry 放入不同函数引用但标记为 `production`，`isGithubAutomationProductionHandlerReady()` 返回 true，`getGithubAutomationJobHandler()` 仍返回当前模块的静态 analysis handler。

### R2：测试隔离行为不退化

- `productionReadinessDisabled=true` 仍在 lease 前拒绝执行：`attempt` 不增加、无 `job_started`、无 leaseOwner。
- `kind=custom` 仅在 handler 可调用时 ready，并继续返回/执行该 custom handler。
- `default`/`none` 的现有测试隔离与恢复语义不得被意外扩大为 production parking handler 执行路径。

**验收：** 现有 readiness-disabled/custom/reset focused tests 继续通过，并新增明确断言。

### R3：真实 production 双入口回归

- smoke 必须加载构建后的 `.next/server/instrumentation.js`，执行 Node register，再加载构建后的 webhook route；不得只加载单一 jobs Retry route，也不得通过源码 jiti 或 bundle 字符串搜索替代。
- 使用临时 `PI_CODING_AGENT_DIR`、临时 HOME、测试 webhook secret、真实 HMAC 和 deterministic pre-network fixture。
- webhook 返回 `202 enqueued` 后，在有界时间内 job 的 `attempt` 增加并出现 `job_started`；不得出现 `analysis_handler_initialization_failed`、`handler_not_ready` 或 `default_handler_defensive_fallback`。
- smoke 网络请求数必须为 0，且不得写入操作员 agentDir。

### R4：死亡 PID lease 安全恢复

- 自动化测试必须只使用临时 agentDir，并构造与 #26 同型的 `running/attempt=1`、死亡 lease owner、过期 heartbeat/updatedAt。
- 未达到 stale 门禁时不得抢占；达到门禁后由 store/scheduler 的现有 stale 判定删除旧 lease、写 `stale_running_reconcile`、取得新 fence、产生下一次 `job_started` 并推进 job。
- 旧 fencing token 在 lease 丢失后不得再写入。

### R5：#26 现场恢复不做破坏性操作

- 修复发布并重启后，等待 durable startup scheduler 按既有阈值恢复 #26；只读取安全状态、event 与 owner PID 生存状态。
- 验证恢复序列至少包含：旧 owner 不再有效、`job_stale_reconcile`、新 `job_started`、`attempt > 1`，以及后续 terminal/retry_due/blocked 的合法 disposition。
- 若超过门禁与合理调度窗口仍未恢复，停止并报告 owner/PID/heartbeat/lastError 的安全诊断，不删除 lock、不改 job、不绕过 fencing。

### R6：兼容性与文档

- 无 API、job/config schema、UI、权限、持久化迁移变化。
- 文档必须说明 readiness 的 bundle 稳定身份语义、双入口 production gate，以及死亡 owner 的自动恢复/禁止手改规则。

## 非功能要求

- 最小改动：不依赖 Next shared-chunk 去重或具体 chunk/module id。
- 测试隔离：无真实 GitHub/provider 网络，无真实凭据，无操作员目录写入。
- 安全：不输出 webhook secret、App credentials、Issue body、绝对生产路径或完整 fencing token。
- 可回滚：代码回退不需要迁移；但回退到 0.8.11 只能临时恢复 startup bundle，后续 webhook 仍可能复现，不能作为长期修复。

## UI 原型门禁

**不触发。** 本任务无页面、前端功能、交互、确认体验、文案或用户可见信息结构变化，无需 UI 设计员或 HTML 原型。若实施发现必须增加 UI/操作按钮/错误文案，应停止实施并回到 planning 重新触发 UI gate。

## 未决问题

1. 主会话/用户是否批准上述最小 readiness 语义与双入口 production smoke。
2. 发布与 #26 恢复 UAT 的操作窗口由主会话决定；推荐修复发布后重启并等待自动 reconcile。
3. 如 #26 在安全门禁后仍不恢复，是否另开运维调查任务；本计划不预授权手工清锁或改 job。
