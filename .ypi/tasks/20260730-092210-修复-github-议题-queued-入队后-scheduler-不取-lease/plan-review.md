# 计划审批书：修复 GitHub 议题入队后 scheduler 不取 lease

## 请求审批

已确认 0.8.11 的根因：Next 生产构建把 instrumentation 与 webhook route 编译为不同 scheduler/analysis-handler 模块；两份模块共享 `globalThis` registry/state，却用各自 handler 函数引用做 readiness 严格相等比较。webhook wake 接管共享 timer 后，route bundle tick 在 job scan/lease 前持续返回 `analysis_handler_initialization_failed`，因此 #26 原始状态长期为 `queued / attempt=0 / leaseOwner=null`。

本计划只修复这一后端运行时边界并补足回归/恢复门禁，**当前不修改生产代码**。主会话保存 implementationPlan 后可将任务切到 `awaiting_approval`；用户明确批准前不得实施。

## 审批材料

- [Brief / 生产证据、精确复现与现场警告](brief.md)
- [PRD / 范围、R1–R6 与验收标准](prd.md)
- [Design / 跨 bundle 契约、数据流、恢复与风险](design.md)
- [Implement / 人类子任务表 + schemaVersion 2 DAG](implement.md)
- [Checks / 自动、production gate、#26 UAT 与 blocker](checks.md)

## PRD 摘要

1. production readiness 以跨 bundle 稳定的 `registration.kind === "production"` 表示模式，不再比较 production handler 函数对象身份。
2. production 实际执行 handler 仍是**当前 bundle 本地静态** `githubIssueAnalysisJobHandler`；不会执行 registry 中另一 bundle 的 production function。
3. test-only custom、reset、`productionReadinessDisabled` 语义不变；disabled 仍在 lease 前返回，零 attempt、零 `job_started`。
4. production smoke 强制加载真实 built `instrumentation → webhook route`，通过真实 HMAC `issues.opened` 入队并验证 lease/`job_started`；不以单一 Retry route、源码测试或 bundle 字符串搜索替代。
5. 使用临时 agentDir 构造 `running/attempt=1 + 死亡 PID lease`，验证 fresh lock 不抢、stale 后自动 reconcile、新 fence 接管、旧 fence 写入失败。
6. 真实 #26 只在修复发布后做只读恢复观察；禁止删 lock、手改 job/attempt/status/fence 或伪造 event。
7. 无 UI、API、schema、配置、权限或数据迁移变化。

## UI Gate

**不触发。** 无页面、组件、CSS、文案、用户可见信息结构、确认或审批体验变化；无需 UI 设计员和 HTML 原型。

若实现发现必须增加 UI、强制解锁按钮、API 错误/状态字段或用户操作流程，必须停止并回到 planning 重新触发 UI gate。

## Design 摘要

```text
instrumentation bundle A: global registry { kind=production, handler=A }
webhook bundle B wake:
  readiness(kind=production + local static handler callable) -> true
  selected handler -> B 的本地静态 analysis handler
  list -> lease/fence -> attempt++ -> job_started -> analysis
```

- `registration.handler` 保留以兼容现有类型与 custom test override，但不再作为 production identity token。
- readiness 在 tick、每个候选启动前、lease 内的复检不删除。
- lease heartbeat、PID/processEpoch、fencing、job stale 5 分钟、lock stale 60 秒等既有算法/阈值均不改。
- 不依赖 Next 是否把入口去重到 shared chunk，也不硬编码当前 chunk/module id。

## Implementation Plan 摘要

计划含 5 个 schemaVersion 2 子任务，最大并发 2：

| ID | 内容 | 依赖 |
| --- | --- | --- |
| `READY-01` | readiness 最小修复 + foreign function/custom/disabled 回归 | — |
| `LEASE-02` | temp 死亡 owner/stale-running/fencing 自动恢复回归 | — |
| `BUNDLE-03` | built instrumentation→webhook production smoke | READY-01 |
| `DOCS-04` | architecture/library/integration/test/troubleshooting 对齐 | READY-01, LEASE-02 |
| `CHECK-05` | focused、lint、tsc、build smoke、checker 与 #26/UAT | BUNDLE-03, DOCS-04 |

`READY-01` 与 `LEASE-02` 可并行；随后 bundle test 与 docs 可并行；`CHECK-05` 为最终 barrier。DAG 机器计划内嵌于 [implement.md](implement.md)。

## Checks 摘要

```bash
npm run test:github-automation
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check

# 本修复的 production/release gate；禁止 bare next build
npm run build
npm run test:github-automation-production-runtime
```

关键 blocker：

- 仍做跨 bundle production 函数引用比较；
- production 执行 foreign registry handler；
- disabled path 消耗 lease/attempt；
- production smoke 未覆盖 built instrumentation→webhook；
- smoke 发生真实网络或操作员目录写入；
- 死亡 lease 测试/现场恢复依赖强删 lock、手改 job 或放宽 fencing/PID/stale 门禁；
- 未审批 UI/API/schema/force-unlock scope creep。

## #26 现场恢复决策

排查子进程 PID 53381 已将真实 #26 从原始 queued 推进到 `running/attempt=1/phase=analyzing` 后退出，留下死亡 owner lease；未手工删除或改写。

推荐方案：

1. 批准并实现本修复；
2. 发布后重启含修复版本；
3. 等待既有 stale-running 与 lease stale/PID/fencing 门禁自动 reconcile；
4. 只读确认 `job_stale_reconcile → 新 job_started → attempt>1`；
5. 再连续创建两个测试 Issue，第二个用于证明 webhook bundle 接管 timer 后仍正常调度。

若超过门禁与合理调度窗口仍不恢复，报告 blocker 并另行调查；**不批准**直接删除真实 lock、修改 job 或用 0.8.11 重启冒充长期修复。

## 兼容、回滚与剩余风险

- 无配置/job/lease/API/UI 数据迁移；代码回滚简单，但回滚旧 readiness 会重新暴露故障。
- `paused=true`/`enabled=false` 仍是紧急 stop-bleed，历史 delivery/job/event/lock 必须保留。
- PID reuse 或 live owner 会按设计延迟 lock 回收；应 fail closed 而非绕过。
- production build gate 需新鲜 `.next`；live UAT 依赖指定测试 App/仓库和网络窗口。
- comment/close 的既有 live App UAT 与严格 close gates不因本修复放宽。

## 请用户确认

请明确回复 **「批准」** 或 **「需要修改」**。批准表示同意：

- production readiness 改用稳定 kind 语义，production handler 使用当前 bundle 静态 import；
- 增加 foreign reference 源码测试、真实 instrumentation→webhook production bundle 测试；
- 用临时 fixture 验证死亡 lease 自动恢复；
- 真实 #26 仅等待发布后自动 reconcile，不手改 job/lock；
- 不增加 UI、API、schema、force-unlock 或数据迁移。
