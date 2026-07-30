# Design：GitHub automation scheduler 跨 bundle readiness 修复

## 方案摘要

将 production readiness 从“共享 registry handler 与当前 bundle handler 函数引用相等”改为“共享 registry 的稳定 kind 表示 production 模式，当前 bundle 本地静态 handler 可调用”。

核心原则：

- **共享的是模式状态，不共享 production 函数身份。** `globalThis.__piGithubAutomationHandlerRegistry.registration.kind` 是跨 bundle 稳定字符串；函数对象不是。
- **执行的是本 bundle 静态 handler。** `getGithubAutomationJobHandler()` 在非 custom、非 disabled 路径继续返回当前 bundle 的 `githubIssueAnalysisJobHandler`。
- **readiness 仍在 lease 前。** test-only disabled 或无可用 custom 时继续零 lease、零 attempt、零 `job_started`。
- **不依赖构建切块。** 无论 Next 将两个入口去重为共享 chunk 还是复制成两份模块，语义都相同。

## AS-IS

```text
instrumentation bundle A
  ├─ imports scheduler A + handler A
  ├─ initializes global registry = { kind: production, handler: A }
  └─ arms global scheduler timer with tick A

webhook bundle B
  ├─ imports scheduler B + handler B
  ├─ enqueue job
  ├─ ensure/wake clears shared timer and arms tick B
  └─ readiness: registry.handler(A) === handler(B)  // false
       └─ lastError=analysis_handler_initialization_failed
          return before list/lease
```

表象因此是 `delivery_enqueued` 后 job 长期 `queued / attempt=0 / leaseOwner=null`，且无 `job_started`。

## TO-BE

```text
instrumentation bundle A
  └─ global registry = { kind: production, handler: A }

webhook bundle B
  ├─ readiness:
  │    disabled                      -> false
  │    custom + callable             -> true
  │    production + local static fn  -> true
  │    default/none                  -> preserve test fallback semantics
  └─ get handler:
       custom -> registry custom handler
       production/default/none -> handler B (local static import)
```

`registration.handler` 暂时保留以兼容现有类型、测试 helper 与 custom 注入；它不再充当 production 跨 bundle 身份 token。无需修改 global registry schema 或迁移已初始化进程状态。

## 影响模块与边界

| 模块 | 计划改动 | 不改动边界 |
| --- | --- | --- |
| `lib/github-automation-scheduler.ts` | readiness 判定与解释性注释；production 不做函数身份比较 | 调度、timer、lease、fence、disposition、concurrency 不变 |
| `scripts/test-github-automation-gia03.mjs` | 增加 foreign production function 引用回归；保留 custom/disabled | 不触碰真实目录/网络 |
| `scripts/test-github-automation-gia07.mjs` | 临时目录死亡 owner/stale-running 安全恢复回归 | 不改变 store 算法，不强制删真实 lock |
| `scripts/test-github-automation-production-runtime.mjs` | 改为/扩展为 instrumentation→webhook 真实构建入口 smoke | 不硬编码 chunk/module id，不导入源码 TS |
| 文档 | 更新 HNR readiness、production gate、运维恢复规则 | API/UI/schema 文档契约不扩展 |

无需修改 `instrumentation.ts`、`app/api/github-automation/webhook/route.ts`、`lib/github-automation-runtime.ts`、`lib/github-automation-store.ts`、analysis runner 或任何前端文件；若实现证据显示必须修改这些业务路径，应停止并重新评审范围。

## Readiness 契约

建议保留现有函数签名，仅调整内部判定：

| 状态 | ready | `getGithubAutomationJobHandler()` | 说明 |
| --- | --- | --- | --- |
| `productionReadinessDisabled=true` + 非 custom/default test stub | false | parking stub | 测试隔离；tick 在 lease 前返回 |
| `kind=custom`, handler callable | true | registry custom handler | focused tests only |
| `kind=production` | 当前 bundle 静态 handler callable 时 true | 当前 bundle 静态 handler | 不读取 production handler 引用作为身份 |
| `kind=default/none`, disabled=false | 保持现有“恢复到本地 production”语义 | 当前 bundle 静态 handler | parking handler 不进入普通 production tick |
| 非法 runtime 状态 | false 或本地静态 fail-closed，按现有类型边界最小处理 | 不执行未知 handler | 不扩大容错为任意函数执行 |

关键不变量：`isGithubAutomationProductionHandlerReady()` 与每次 lease 前复检仍存在；只移除不稳定的 production 引用相等条件。

## 数据流与文件契约

### 正常新 webhook

```text
compiled instrumentation.register()
  → ensure scheduler A
compiled webhook.POST(signed issues.opened)
  → accept webhook
  → exclusive delivery + v2 issue_analysis job
  → ensure/wake scheduler B
  → readiness(kind=production)
  → list jobs
  → filesystem job lease + new fencing token
  → attempt++ + job_started
  → bundle B local static analysis handler
```

生产 bundle smoke 使用合法 HMAC 和真实 route userland POST。fixture 的 `repositoryFullName` 刻意在 handler 内触发 `malformed_full_name`，因此能够证明进入真实 handler，同时在 GitHub token/model/network 之前确定性结束。

### #26 同型死亡 lease 恢复

```text
job: running/attempt=1, updatedAt older than STALE_RUNNING_MS
lock owner: dead PID, heartbeat older than LOCK_STALE_MS
startup ensure
  → markStaleRunningAsRetry
       status=retry_due
       reason=stale_running_reconcile
       clear durable lease fields
       event job_stale_reconcile
  → candidate acquisition
       store validates stale heartbeat + dead/reused PID rules
       removes stale lock only after gates
       issues new fencing token
  → attempt=2 + job_started
  → old fencing token rejected
```

注意 job stale 阈值（scheduler 当前 5 分钟）与 lock stale 阈值（store 当前 60 秒）是两个独立门禁；本任务不改变常量。job 字段被 reconcile 清空不等于绕过 lock，真正 acquisition 仍由 lock owner/heartbeat/PID/fencing 规则控制。

## 测试设计

### 1. 源码 readiness 回归

在 GIA-03 临时测试中：

1. reset registry；
2. 将共享 registry registration 设为 `kind=production`，handler 使用独立 foreign function；
3. 断言 readiness 为 true；
4. 断言 selected handler 是当前 source module 的 `runner.githubIssueAnalysisJobHandler`，不是 foreign function；
5. 继续验证 custom callable、reset、disabled 零 lease。

测试不得通过把 foreign function 设为 custom 来替代，因为 custom 本来就应执行共享函数。

### 2. production bundle 双入口 smoke

- 前置：`npm run build`，禁止 bare `next build`。
- 入口顺序：设置 temp env → require built instrumentation → 调用 Node `register()` 并等待 startup arm/tick → require built webhook route → 调用真实 `POST`。
- 使用测试 secret 生成 `sha256=` HMAC；request 为 human `issues.opened`、allowlisted repo/installation。
- 从 202 response 获取 `jobId`，轮询 temp job/event。
- 断言：`attempt >= 1`、`job_started`、真实 handler 的 deterministic `malformed_full_name`；共享 scheduler `lastError !== analysis_handler_initialization_failed`；无 `handler_not_ready`/default fallback；fetch 0 次；无 operator-dir write。
- 测试只引用稳定 `.next` entry 路径和公开 route export；不得依赖当前 `chunks/6180.js`、`chunks/3548.js` 或 Webpack module id。

### 3. 死亡 lease 安全恢复

在 GIA-07 的临时 agentDir 中使用独立子进程取得 job lease 后退出，留下真实 owner metadata：

1. 新鲜 heartbeat 下，短等待 acquisition 必须失败，证明不因 PID 已死立即无门禁抢锁；
2. 仅通过 test helper 老化临时 heartbeat，并把临时 job `updatedAt` 设为 stale-running；
3. scheduler 使用 custom deterministic handler 跑一次；
4. 断言 `job_stale_reconcile`、新 `job_started`、attempt 从 1 到 2、new fence 与旧 fence 不同、最终合法 disposition；
5. 使用旧 fencing token 的临时写入被拒绝；
6. cleanup 仅删除 temp agentDir。

不得读取或改写真实 #26。

## 兼容性与迁移

- **运行时兼容：** 已初始化 global registry 无需重建；已有 `kind=production` 可被任何 bundle 正确识别。
- **数据兼容：** config v2、job v2、delivery/event/lease owner 格式均不变；无迁移。
- **API/UI：** webhook/status/verify/jobs 响应与 Settings UI 不变。
- **多进程：** process-global readiness 只解决同进程 bundle 身份；跨进程业务去重仍由 filesystem lease + fencing 保证。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 将任意 registry production handler 当成可执行对象 | production 始终选择本 bundle 静态 import；kind 只表示模式 |
| custom 测试行为被 production fallback 覆盖 | 单独回归 custom callable 和 selected handler |
| production smoke 又退化为单入口或源码测试 | 强制 built instrumentation→built webhook 顺序与真实 HMAC POST |
| 测试误写操作员目录/联网 | temp HOME/agentDir、env restore、fetch sentinel、outside probe、finally cleanup |
| 死亡 lease 测试通过强删伪造结果 | 子进程真实留锁；先验证新鲜 lock 不可抢，再通过 test-only aging 触发既有门禁 |
| #26 PID 被复用或 threshold 尚未到 | fail closed 等待/报告；不删 lock、不改 job |
| 0.8.11 重启看似恢复后再次故障 | UAT 必须再触发至少两个新 Issue，覆盖 webhook route 接管 timer 后继续调度 |

## 回滚

代码回滚只需恢复 readiness 与测试/文档，无数据回滚。但回到旧函数引用比较会重新暴露跨 bundle 故障，不能把“重启暂时由 instrumentation bundle 处理”视为可靠止血。

紧急 stop-bleed 仍使用既有 `paused=true` 或 `enabled=false`，保留 delivery/job/event；不得删除 #26 lock/job。恢复旧版本时也不得让 v2 job 被旧逻辑重写。
