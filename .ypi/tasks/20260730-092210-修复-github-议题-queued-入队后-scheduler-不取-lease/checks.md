# Checks：GitHub automation scheduler 跨 bundle readiness 修复

## 需求覆盖检查

| 检查项 | 通过条件 | Blocker |
| --- | --- | --- |
| production identity | readiness 使用稳定 `kind=production` 语义，不比较跨 bundle handler 引用 | 仍出现 `registry.handler === localHandler` 或等价对象身份判断 |
| local static handler | production 实际执行当前 bundle 静态 analysis handler | 执行共享 registry 中另一 bundle 的 production function |
| custom 行为 | callable custom ready 且被选中 | custom 被忽略或被 production 覆盖 |
| disabled 行为 | disabled tick 零 lease、零 attempt、无 `job_started` | parking/default handler 在 production lease 下运行 |
| 双入口构建回归 | built instrumentation register 后再 load/POST built webhook | 只测 jobs Retry route、源码 jiti、字符串扫描或硬编码 chunk id |
| webhook 调度 | 202 enqueued 后有界时间内 attempt 增加、有 `job_started` | queued/attempt=0 且 scheduler 报 initialization failed |
| 安全恢复 | temp running/dead PID lease 经 stale 门禁自动 reconcile，新 fence 接管 | 通过 force delete/手改真实 job/绕过 fencing 得到“通过” |
| 旧 fence | ownership 变化后旧 token 写入被拒绝 | stale owner 仍可覆盖新 owner 状态 |
| 兼容性 | API/UI/config/job/lease schema 不变，无迁移 | 新增未审批 UI、force-unlock API、schema/阈值变化 |
| 现场 #26 | 发布后只读观察自动恢复或明确报告 blocker | 删除真实 lock、改 job/attempt/status/fence、伪造 event |

## 自动验证

### 1. 源码 focused suite

```bash
npm run test:github-automation
```

重点断言：

- foreign production handler function：ready=true，但 selected handler 为本地静态 analysis handler；
- custom callable：ready=true 且 selected=custom；
- readiness disabled：started=0、attempt 不变、leaseOwner=null、无 `job_started`；
- 死亡 lease fixture：fresh heartbeat 不被抢；stale 后 `job_stale_reconcile` → 新 `job_started` → attempt 1→2；
- old fence 写入失败；
- 全部使用 temp `PI_CODING_AGENT_DIR`，无真实网络/凭据。

### 2. 静态质量

```bash
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

补充 source review：

```bash
rg -n '=== githubIssueAnalysisJobHandler|analysis_handler_initialization_failed|productionReadinessDisabled' \
  lib/github-automation-scheduler.ts scripts/test-github-automation-gia03.mjs
rg -n 'instrumentation|webhook|chunk|module id|handler_not_ready|job_started' \
  scripts/test-github-automation-production-runtime.mjs
```

目标不是禁止错误码作为防御诊断，而是确认 production ready 分支不再依赖函数引用，并且 smoke 不依赖生成的 chunk/module id。

### 3. production artifact gate

```bash
npm run build
npm run test:github-automation-production-runtime
```

要求：

1. 必须使用项目 wrapper `npm run build`，不得直接 `next build`。
2. 测试实际加载 `.next/server/instrumentation.js` 并执行 Node register。
3. 之后加载 `.next/server/app/api/github-automation/webhook/route.js`，以真实 HMAC 调用 POST。
4. response 为 `202`/`enqueued`；temp job `attempt >= 1`，events 含 `job_started`。
5. scheduler/event 不含本次 job 的 `analysis_handler_initialization_failed`、`handler_not_ready`、`default_handler_defensive_fallback`。
6. deterministic handler 结果为 `blocked / malformed_full_name`，证明进入真实 analysis handler。
7. `networkAttempts=0`；real-home/operator agentDir probes 不存在。
8. 测试结束恢复 HOME、USERPROFILE、PI_CODING_AGENT_DIR、credential env、fetch，并 best-effort 清 temp 目录。

## 测试质量检查

- production smoke 应在旧 0.8.11 行为下复现失败，而不是只验证修复后的宽松结果。
- built entry export shape 通过运行时读取确认，不通过猜测或固定 Webpack module id。
- webhook fixture 使用 human `issues.opened`、allowlisted repository id、exact installation id 与合法签名；不能绕过 ingress 直接写 queued job来冒充双入口覆盖。
- malformed full name 仅用于真实 handler 的 pre-network sentinel；若 handler 未运行，测试不能因 timeout 以外的原因误判通过。
- 死亡 owner fixture 由子进程真实取得 lease 后退出；必须先证明 fresh heartbeat 不可抢。
- stale test 不改变 production stale 常量；可用 test helper 老化 temp owner metadata。
- 所有 child/timer/env/fetch 清理必须位于可靠的 `finally` 或等价收尾路径，避免后续测试串扰。

## 人工代码评审

### Scheduler

- [ ] `isGithubAutomationProductionHandlerReady()` 的 production 分支只依赖稳定 kind 与本地静态 handler 可用性。
- [ ] production/default/none 不返回 registry production handler。
- [ ] callable custom 仍返回 registry custom handler。
- [ ] disabled、tick 前、toStart 前、lease 内复检未被删除。
- [ ] `analysis_handler_initialization_failed` 仍只表示真正的 readiness isolation/failure，不再由 bundle identity 误报。
- [ ] 未修改 job selection、maxConcurrency、timer、disposition、heartbeat、fencing 或 stale 阈值。

### Production smoke

- [ ] instrumentation 在 webhook route 之前加载和 register。
- [ ] 使用真实 route userland POST + HMAC。
- [ ] 不导入 source TypeScript，不依赖 chunk 名/数字模块 id。
- [ ] temp env 在模块加载前设置。
- [ ] fetch sentinel 与 operator path probes 生效。
- [ ] assertion 同时覆盖 attempt、event、lastError、真实 handler outcome。

### Lease recovery

- [ ] job stale（当前 5 分钟）与 lock heartbeat stale（当前 60 秒）分别被验证。
- [ ] fresh heartbeat 下即使 owner PID 死亡也不立即抢锁。
- [ ] stale removal 仍受 PID/processEpoch 门禁控制。
- [ ] old fence 无写权限，新 lease 只产生一次真实 handler side effect。
- [ ] 不使用 `_testForceRemoveLeaseDir` 作为成功路径。

### 范围

- [ ] 无 `components/`、hooks、CSS 或用户可见文案变更。
- [ ] 无 API response、config/job/event/lease owner schema 变化。
- [ ] 无 App credential、Issue body、absolute path、full fencing token 进入日志/文档/测试输出。
- [ ] 无真实 #26 文件写入。

## #26 发布后安全恢复 UAT

> 仅在用户批准、修复实现/发布完成且主会话安排维护窗口后执行。规划/实现测试阶段不得触碰真实 #26。

### 前置只读确认

- 确认运行版本/BUILD_ID 为含修复版本，不是 0.8.11。
- 确认 automation `enabled=true`、`paused=false`，但不通过 config 写入制造唤醒。
- 只读确认 #26 当前 `running/attempt=1/phase=analyzing`、旧 lease owner PID 与 heartbeat/update 时间。
- 使用 OS 只读 PID 生存检查确认旧 PID 已退出；不要输出 secrets、Issue body、绝对 credential path 或完整 fence。

### 恢复观察

1. 重启含修复的服务，让 Node instrumentation startup ensure 生效。
2. 等待既有 job stale-running 与 lease stale/PID 门禁；不删 lock，不改 job。
3. 观察 safe events：`job_stale_reconcile` 后应出现新的 `job_started`。
4. 确认 `attempt > 1`、新 lease owner/fence 生效，旧 owner 不再写入。
5. 允许 handler 按正常 disposition 进入 completed/blocked/retry_due；不得要求强行 completed 才算 scheduler 修复成功。
6. 若超过两个 stale 门禁加合理 poll/handler 启动窗口仍无新 lease，记录安全诊断（version、status、attempt、phase、reason、lastError、owner PID live/dead、时间），停止并报告 blocker。

### 新 webhook UAT

在指定测试仓库依次创建两个受控 human Issues：

- Issue A：`delivery_enqueued` 后有界时间内 lease/`job_started`；
- Issue B：在 webhook route 已加载并接管 timer 后再次有界调度；
- 两者均无 `analysis_handler_initialization_failed`，且未发生重复 handler side effect。

Live App comment/close 仍受项目既有 UAT 门禁；本任务仅证明 scheduler 链路，不放宽 close gates。

## 回归风险

1. **同进程多 bundle：** 最核心风险；必须由 production artifact test 覆盖。
2. **跨进程竞争：** readiness 修复不替代 filesystem lease/fencing；现有 multi-process suite 必须继续绿。
3. **测试 override：** custom/default/disabled 是 focused tests 的隔离能力，不能被 production kind 简化破坏。
4. **timer 接管：** 仅 startup 成功不足；第二个 webhook 是必要 UAT。
5. **死亡 lease：** PID reuse/live owner 应 fail closed，恢复可能延后，不能因此绕过门禁。
6. **构建环境：** production gate 依赖新鲜 `.next`；旧构建结果不能用于结论。

## Blocker 规则

出现以下任一情况不得批准实现完成：

- 仍有 production handler 函数引用相等比较；
- production 使用 registry 中的 foreign handler；
- disabled path 消耗 attempt/lease；
- built test 未覆盖 instrumentation→webhook；
- production smoke 发生真实网络或操作员目录写入；
- stale recovery 依赖强删 lock、手改真实 job 或放宽 fencing/PID/stale 常量；
- #26 UAT 被人为改状态后宣称自动恢复；
- 未审批 UI/API/schema/force-unlock scope creep；
- `npm run build` 之外直接运行 `next build`。
