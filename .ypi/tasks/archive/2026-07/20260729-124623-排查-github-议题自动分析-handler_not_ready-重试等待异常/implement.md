# Implement — GitHub analysis handler readiness 与 durable retry

## 1. 执行原则

- 只修 production handler 装载、scheduler deadline/timer、server startup reconcile、测试与文档。
- 不修改 analysis 结论、证据预算、comment/close gates、webhook ingress、job schema或UI。
- 不手工编辑 #25 job；实现后的启动恢复必须使用既有 durable state。
- 先让 production handler 在 lease 前确定，再修 timer/startup；不得用“UI自动点Retry”掩盖后端缺陷。
- 所有生产日志只使用固定安全 code；不输出 raw module error、stack、路径或凭据。
- 不commit/push/merge。

## 2. 实现前优先阅读

| 顺序 | 文件 | 目的 |
| --- | --- | --- |
| 1 | [brief.md](brief.md)、[prd.md](prd.md)、[design.md](design.md)、[checks.md](checks.md) | 根因、契约与验收 |
| 2 | `lib/github-automation-scheduler.ts` | registry、lease、disposition、timer、wake/ensure |
| 3 | `lib/github-issue-analysis-runner.ts` | handler contract、checkpoint与反向注册 |
| 4 | `lib/github-automation-runtime.ts`、`lib/github-automation-projection.ts` | webhook wake、人工Retry、status只读边界 |
| 5 | `lib/github-automation-store.ts`、`lib/github-automation-types.ts` | schedulable、lease/fence、job/disposition类型 |
| 6 | `scripts/test-github-automation-gia01.mjs`、`gia03`、`gia04`、`gia07` | 当前测试为何未覆盖生产bundle/timer |
| 7 | `scripts/build-next.js`、`next.config.ts`、`package.json` | Webpack production artifact与验证入口 |
| 8 | `docs/architecture/overview.md`、`docs/modules/{api,library,frontend}.md`、`docs/operations/troubleshooting.md` | 文档契约与runbook |

## 3. 人类可读子任务表

| ID | Phase | 标题 | dependsOn | 主要文件 | 并行 |
| --- | --- | --- | --- | --- | --- |
| HNR-01 | handler-boundary | 直接绑定production analysis handler并前置readiness | — | scheduler、runner、types、gia03 tests | 否 |
| HNR-02 | scheduler | 重构durable deadline/timer与job settlement rescan | HNR-01 | scheduler、gia07/focused tests | 否 |
| HNR-03 | startup | Node server启动恢复pending/overdue jobs | HNR-02 | instrumentation、scheduler、startup tests | 否 |
| HNR-04 | verification-docs | Production artifact smoke、文档、全量门禁与UAT | HNR-01,HNR-02,HNR-03 | scripts/package/docs | 否 |

建议 `maxConcurrency=1`：前三项共享 scheduler 初始化与timer状态，串行可减少竞态回归。

## 4. 详细执行说明

### HNR-01 — Production handler boundary

1. 把 `GithubAutomationJobHandler` / result contract 移到无runtime cycle的leaf types（可复用现有types文件），runner只做type import。
2. scheduler静态直接引用 `githubIssueAnalysisJobHandler`；删除无参同步`require("./github-issue-analysis-runner")`生产路径。
3. registry若为focused tests保留，改成显式test override；production默认始终是真实handler，`defaultJobHandler`不可由普通tick选择。
4. readiness在`withGithubAutomationJobLease`和`job_started`之前确定；任何初始化失败不得增加attempt或写business lease事件。
5. 删除或隔离runner的反向register convenience，避免双向runtime import。
6. 更新GIA-03：必须覆盖默认production handler，而不只传入handler function。
7. 增加source runtime断言：reset test registry后production tick仍选真实handler；只有显式test hook可替换。

### HNR-02 — Durable timer/deadline

1. 为scheduler state增加内部`nextWakeAtMs`和可注入clock/timer adapter；生产使用`Date.now/setTimeout/clearTimeout`，测试用fake scheduler。
2. 将`armTimer`改为deadline-aware：更晚请求不覆盖更早timer，immediate wake可提前；timer fire时原子清空handle/deadline。
3. 移除“disposition schedule + job finally poll”互相覆盖的双重authority；job settle后触发rescan，由disk job truth决定下一deadline。
4. tick扫描后计算最早pending deadline：queued now、retry_due nextRetryAt、running stale/settlement；无pending则停止。
5. future retry即使早到tick也必须重新安排剩余deadline。
6. 保留maxConcurrency、inFlight、lease heartbeat/fencing、no-progress指数backoff和稳定block。
7. fake-clock覆盖HNR-TIMER-03/04、IDLE-05、NOSPIN-09，不使用真实sleep作为正确性证据。

### HNR-03 — Server startup reconcile

1. 新增根级`instrumentation.ts`，仅Node runtime fire-and-forget调用`ensureGithubAutomationScheduler()`；build/edge不启动。
2. startup ensure读取durable jobs并恢复queued、到期retry_due和stale-running v2 analysis job；legacy/terminal继续跳过。
3. paused/disabled且有pending job时只做低频配置重检，不取得job lease；无pending job时停止timer等待webhook。
4. 双ensure/多process场景继续由现有job lease+fence保证一次真实执行。
5. 不通过status/verify GET或页面poll启动scheduler；config route现有直接副作用契约保持不变。
6. 测试HNR-START-06/07、PAUSE-08，并验证timer/test state完整清理。

### HNR-04 — Production bundle、文档与验收

1. 新增`scripts/test-github-automation-production-runtime.mjs`和package script。
2. 脚本使用temp agentDir，预置enabled config和retry_due v2 job，加载真实`.next` jobs Retry route；fixture在任何网络前由真实handler确定性结束。
3. 断言非`handler_not_ready`、无default fallback、attempt/event正确、零真实网络、零用户agentDir写入。
4. `npm run build`后执行production smoke；不得用源码jiti或静态bundle搜索代替。
5. 将focused production smoke纳入release验证说明，但避免日常每个unit suite隐式重build。
6. 更新architecture durable scheduler、library map、API route副作用说明（若未变只校正）、troubleshooting中的overdue retry诊断与startup恢复。
7. 跑focused、lint、tsc、build、production smoke、diff-check。
8. 部署后不点击Retry，观察#25由startup reconcile继续；在测试App完成冷进程新Issue UAT。

## 5. 验证命令

```bash
npm run test:github-automation
npm run lint
node_modules/.bin/tsc --noEmit
npm run build
npm run test:github-automation-production-runtime
git diff --check
```

## 6. 检查门禁

- HNR-01：checker确认production bundle不再同步读取async runner export，default handler不可达。
- HNR-02：checker用fake clock复核early tick、deadline replacement、settlement rescan和no-spin。
- HNR-03：checker确认Node-only startup、多process lease/fence、paused零lease、无pending停timer。
- HNR-04：checker必须看到真实`.next` runtime smoke，不接受静态正则或当前jiti suite替代。
- 全局：status/verify仍零wake；webhook request thread仍不运行模型；result/comment/close幂等与privacy suite全绿。

## 7. 回滚与止血

- 运行止血：`paused=true`；保留job/event，不删除#25。
- 若startup bootstrap造成异常，可临时关闭bootstrap，但保留direct handler与timer修复，并人工Retry恢复；记录为临时降级。
- 不回滚到同步dynamic require/default fallback，不以浏览器轮询或自动点Retry替代scheduler。

## 8. Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "summary": "Fix GitHub issue-analysis handler_not_ready by directly binding the production handler, making retry deadlines durable, and reconciling pending jobs at Node server startup without UI changes.",
  "strategy": "First remove the production sync-require/default-handler path and establish the real analysis handler before any business lease. Then centralize timer ownership around durable queue deadlines with a fake-clock test boundary. Add Node-only startup reconciliation so overdue jobs recover after deployment. Finish with a real .next production-artifact smoke, docs, and live test-App validation.",
  "maxConcurrency": 1,
  "sourceArtifact": "implement.md",
  "subtasks": [
    {
      "id": "HNR-01",
      "title": "Bind the single production analysis handler before any business lease",
      "phase": "handler-boundary",
      "order": 10,
      "dependsOn": [],
      "relation": "serial",
      "files": [
        "lib/github-automation-scheduler.ts",
        "lib/github-issue-analysis-runner.ts",
        "lib/github-automation-types.ts",
        "scripts/test-github-automation-gia03.mjs"
      ],
      "instructions": [
        "Move the handler contract to a leaf type boundary so the runner does not create a runtime scheduler cycle.",
        "Statically bind githubIssueAnalysisJobHandler in the production scheduler; remove the no-argument synchronous require of the runner.",
        "Keep handler injection only as an explicit test override, and make the default parking handler unreachable from production ticks.",
        "Resolve production handler readiness before withGithubAutomationJobLease, job_started, and attempt increment.",
        "Remove or isolate the runner's reverse registration helper.",
        "Add a default-production-handler test that does not pass the handler function manually."
      ],
      "acceptance": [
        "A cold production path selects the real issue-analysis handler on the first job.",
        "Handler bootstrap failure cannot acquire a business lease or increment attempt.",
        "No ordinary production path emits default_handler_defensive_fallback.",
        "Legacy v1 jobs remain unschedulable and focused handler override tests still work."
      ],
      "validation": [
        "npm run test:github-automation",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "A careless static import can create a runtime circular initialization.",
        "Test-only overrides can accidentally remain reachable from production code."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "HNR-02",
      "title": "Make scheduler timers derive from durable retry deadlines",
      "phase": "scheduler",
      "order": 20,
      "dependsOn": ["HNR-01"],
      "relation": "serial",
      "files": [
        "lib/github-automation-scheduler.ts",
        "scripts/test-github-automation-gia07.mjs"
      ],
      "instructions": [
        "Introduce an injectable scheduler clock/timer boundary and track the currently armed deadline.",
        "Use earliest-deadline semantics so unrelated later schedules cannot replace an earlier wake.",
        "Remove competing disposition and finally timer ownership; rescan durable jobs after settlement.",
        "After every tick, derive the next wake from queued, retry_due, and stale-running job truth.",
        "If a tick arrives before nextRetryAt, arm the remaining deadline instead of going idle.",
        "Preserve maxConcurrency, inFlight exclusion, heartbeat/fencing, retry budget, and no-progress block behavior."
      ],
      "acceptance": [
        "A five-second retry still runs after an earlier two-second tick without external wake.",
        "Future-only queues always retain a timer until due.",
        "No pending jobs leave no scheduler timer and no busy polling.",
        "No-progress paths remain bounded and never spin as immediate queued work."
      ],
      "validation": [
        "npm run test:github-automation",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Timer bookkeeping races can create duplicate ticks or lose the only wake.",
        "Continuous polling can add filesystem load if no-job and paused paths are not bounded."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "HNR-03",
      "title": "Reconcile pending analysis jobs when the Node server starts",
      "phase": "startup",
      "order": 30,
      "dependsOn": ["HNR-02"],
      "relation": "serial",
      "files": [
        "instrumentation.ts",
        "lib/github-automation-scheduler.ts",
        "scripts/test-github-automation-gia07.mjs"
      ],
      "instructions": [
        "Add a Node-runtime-only Next instrumentation bootstrap that fire-and-forget ensures the scheduler.",
        "Recover overdue queued/retry_due/stale-running schema-v2 issue_analysis jobs without a webhook or status request.",
        "When pending jobs are paused or disabled, perform bounded low-frequency config rechecks without taking a job lease.",
        "Stop scheduling when no non-terminal analysis jobs remain.",
        "Exercise duplicate ensure and multi-owner lease/fence behavior.",
        "Keep status and verify GET read-only and non-waking."
      ],
      "acceptance": [
        "An overdue durable job resumes after server startup with no user action.",
        "Paused jobs receive zero leases and resume in bounded time after configuration recovery.",
        "Concurrent startup ensure calls do not duplicate handler side effects.",
        "Build and edge contexts do not start the scheduler."
      ],
      "validation": [
        "npm run test:github-automation",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Next instrumentation can run in more than one server process.",
        "Startup imports can accidentally block readiness or execute during build."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "HNR-04",
      "title": "Add production-bundle smoke coverage, update docs, and validate live recovery",
      "phase": "verification-docs",
      "order": 40,
      "dependsOn": ["HNR-01", "HNR-02", "HNR-03"],
      "relation": "serial",
      "files": [
        "scripts/test-github-automation-production-runtime.mjs",
        "package.json",
        "docs/architecture/overview.md",
        "docs/modules/library.md",
        "docs/modules/api.md",
        "docs/operations/troubleshooting.md"
      ],
      "instructions": [
        "Create a temp-agentDir smoke that invokes the actual built .next jobs route and proves the first production handler is not handler_not_ready.",
        "Use a deterministic pre-network terminal fixture and assert zero real network and zero user-agentDir writes.",
        "Document direct handler binding, deadline-driven scheduling, startup recovery, and overdue retry diagnostics.",
        "Run focused tests, lint, typecheck, the wrapped production build, the production runtime smoke, and diff-check.",
        "After deployment, observe issue 25 resume without clicking Retry; use paused=true before rollout if remote comments are not desired.",
        "Complete a cold-process test-App Issue UAT without weakening comment or close gates."
      ],
      "acceptance": [
        "The real .next artifact processes the first retry through the analysis handler and never emits default_handler_defensive_fallback.",
        "All existing GitHub automation privacy, no-loop, checkpoint, comment, and close tests pass.",
        "Docs match the implemented direct-handler and startup scheduler boundaries.",
        "Issue 25 or an equivalent durable fixture recovers without a second webhook or manual Retry."
      ],
      "validation": [
        "npm run test:github-automation",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run build",
        "npm run test:github-automation-production-runtime",
        "git diff --check"
      ],
      "risks": [
        "A smoke that imports source modules instead of .next would miss the original regression.",
        "Deploy-time automatic recovery can immediately publish the existing canonical analysis comment."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    }
  ]
}
```
