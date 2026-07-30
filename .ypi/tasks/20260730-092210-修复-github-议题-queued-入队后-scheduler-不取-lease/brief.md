# brief

## 结论

已用 **0.8.11 已安装生产包的真实 `.next` 编译产物**复现，根因不是 job status、文件扫描或 lease 获取条件，而是 **Next 将 instrumentation 与 webhook route 编译成两份 scheduler/analysis-handler 模块后，生产 readiness 用函数引用做跨 bundle 身份比较**。

- instrumentation 入口：`.next/server/instrumentation.js` → `chunks/6180.js`，scheduler module `26180`，analysis handler module `46608`。
- webhook 入口：`.next/server/app/api/github-automation/webhook/route.js` → `chunks/3548.js`，scheduler module `29873`，analysis handler module `81309`。
- 两份 scheduler 共用 `globalThis.__piGithubAutomationHandlerRegistry` 与 `globalThis.__piGithubAutomationScheduler`。
- instrumentation 先启动时，把 `chunks/6180.js` 的 handler 函数引用写入全局 registry；因此 PID 51850 能正常处理 #25。
- webhook route 入队 #26 后调用其编译产物中的 `ensure (I9)` + `wake (cc)`；wake 强制清除共享 timer，并用 `chunks/3548.js` 自己的 tick 回调重新布置 timer。
- route bundle 的 readiness 检查执行 `registry.handler === routeBundleLocalHandler`。两个 bundle 的函数虽然来自同一源码，但引用不同，结果恒为 false。
- tick 因而只设置 `lastError=analysis_handler_initialization_failed` 并每 2 秒重试；它在 job 列表扫描和 lease 之前返回，所以外部只看到 `queued / attempt=0 / leaseOwner=null`，且没有 `job_started`。

## 线上证据

- 服务：`@alan-zhao/yolk-pi-web@0.8.11`，PID `51850`，监听 `30141`，cwd `/opt/homebrew/lib/node_modules/@alan-zhao/yolk-pi-web`，BUILD_ID `jKY0abjR5-5Zz6Deki85q`。
- 配置：schema v2、`enabled=true`、`paused=false`、`analysis.maxConcurrency=2`；status readiness 为 ready。
- #25：同一 PID 51850 在 `2026-07-30T01:11:32Z`、`01:11:49Z` 取得 lease，最终 completed/attempt=3。
- #26：`2026-07-30T01:13:03.352Z` 已记录 `delivery_enqueued`；原始 job 长期保持 queued/attempt=0，无 job lock、无 `job_started`。
- compiled webhook route 明确在 enqueue 后调用 `I9()` 与 `cc()`；compiled route scheduler readiness 明确以本 bundle 的 `j.si` 严格比较全局 registry handler。

## 精确隔离复现

在临时 `PI_CODING_AGENT_DIR` 中按生产真实加载顺序执行：

1. 加载 `.next/server/instrumentation.js` 并等待 startup tick；registry=`production`、`lastError=null`。
2. 加载 `.next/server/app/api/github-automation/webhook/route.js`，写入一个 temp queued job。
3. 从同一 Webpack runtime 调用 route scheduler module `29873` 的 `ensure/wake`。
4. 等待 2.6 秒。

结果：

```json
{
  "job": { "status": "queued", "attempt": 0, "leaseOwner": null },
  "scheduler": {
    "wakeGeneration": 1,
    "lastError": "analysis_handler_initialization_failed",
    "timerArmed": true
  }
}
```

这与 #26 原始症状完全一致，并排除了 status 解析、job schedulable 判定和 lease store 作为首因。

现有 `npm run test:github-automation-production-runtime` 在 temp agentDir 通过，但它只加载单个 built jobs route，未先加载 instrumentation，因此无法覆盖跨 entry/bundle 函数身份问题。

## 最小修复

仅改 `lib/github-automation-scheduler.ts` 的 production readiness 语义：

- `productionReadinessDisabled=true` 仍拒绝 lease。
- `custom` 仍要求可调用 handler，保留测试覆盖。
- `registration.kind === "production"` 时按稳定 kind/token 判定 ready，**不再比较 production handler 函数引用**。
- `getGithubAutomationJobHandler()` 已会为非 custom 路径返回当前 bundle 本地静态 `githubIssueAnalysisJobHandler`，无需共享跨 bundle 函数引用。

不建议依赖 Next shared-chunk 去重；编译切块不是稳定业务契约。无需 config/job 数据迁移，也无需修改 webhook、status 或 lease store。

## 验证方案

1. 源码测试：模拟全局 production registry 中存在“另一 bundle”的函数引用，readiness 仍为 true；disabled/custom 行为不变。
2. 扩展 `scripts/test-github-automation-production-runtime.mjs`：必须按 `instrumentation → webhook/jobs route` 两入口顺序加载 built `.next`，enqueue/wake 后断言 attempt 增加、有 `job_started`、无 `analysis_handler_initialization_failed`。
3. `npm run test:github-automation`。
4. `npm run build` 后运行 `npm run test:github-automation-production-runtime`。
5. `npm run lint`、`node_modules/.bin/tsc --noEmit`。
6. 生产 UAT：重启后新建测试 Issue，确认 delivery_enqueued 后有界时间内出现 lease/job_started；再发第二个新 Issue，验证 webhook route 已加载后仍可调度。

## 现场状态警告

排查期间有一次诊断子进程误以真实 agentDir 加载了 production instrumentation，PID `53381` 随即为 #26 取得 lease 后退出；这不是代码改动，但已把真实 #26 从原始 `queued/attempt=0` 推进为 `running/attempt=1/phase=analyzing`，并留下该已退出 PID 的 lease。未手工删除或改写 job/lock。

主会话需决定恢复窗口：建议合入修复并发布后重启，让 durable scheduler 在 stale-running/lease 过期门禁后自动 reconcile；不要直接删 lock 或手改 job，以免绕过 fencing。当前 0.8.11 重启只能临时恢复 startup bundle，后续 webhook 仍可再次触发同一跨 bundle readiness 故障。

## 范围与门禁

- 后端运行时修复，无 UI/交互变化，不触发 UI 原型门禁。
- 未修改生产代码，未 commit/push/merge。
