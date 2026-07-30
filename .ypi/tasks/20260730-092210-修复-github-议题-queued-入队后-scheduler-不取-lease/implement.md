# Implement：GitHub automation scheduler 跨 bundle readiness 修复

## 先阅读

1. `AGENTS.md`、`docs/standards/code-style.md`
2. 本任务 `brief.md`、`prd.md`、`design.md`、`checks.md`、`plan-review.md`
3. `docs/architecture/overview.md`（GitHub App issue analysis）
4. `docs/integrations/README.md`（GitHub App issue analysis）
5. `docs/modules/api.md`、`docs/modules/library.md`、`docs/operations/troubleshooting.md`
6. `lib/github-automation-scheduler.ts`
7. `lib/github-automation-store.ts`（lease owner、heartbeat、PID、fencing；原则上不改）
8. `lib/github-automation-runtime.ts`、`instrumentation.ts`、`app/api/github-automation/webhook/route.ts`（调用链审计；原则上不改）
9. `scripts/test-github-automation-gia03.mjs`、`scripts/test-github-automation-gia07.mjs`
10. `scripts/test-github-automation-production-runtime.mjs`、`package.json`

## 实施原则

- 先增加能够复现 foreign production function identity 的 focused test，再做 readiness 最小修复。
- production registry 的 `kind` 是模式 token；production handler 始终使用当前 bundle 静态 import，不执行共享 registry 内的旧 bundle production function。
- 不修改 lease/fencing/stale 常量和算法；#26 同型恢复只在临时 agentDir 验证。
- production smoke 必须使用真实构建入口与 webhook，不硬编码 chunk/module id，不以 jiti 或字符串扫描替代。
- 不修改 UI/API/schema，不手改真实 #26，不 commit/push/merge。

## 人类可读子任务表

| ID | 阶段 | 顺序 | 内容 | 依赖 | 可并行 |
| --- | ---: | ---: | --- | --- | --- |
| READY-01 | core | 1 | 修复 production readiness，并增加 foreign bundle identity/custom/disabled 源码回归 | — | 是 |
| LEASE-02 | recovery-tests | 1 | 用临时 agentDir 验证死亡 PID lease + stale-running + fencing 安全恢复 | — | 是 |
| BUNDLE-03 | production-test | 2 | 扩展真实 `.next` instrumentation→webhook 双入口 smoke | READY-01 | 是 |
| DOCS-04 | docs | 2 | 对齐 architecture/library/integration/test/troubleshooting | READY-01, LEASE-02 | 是 |
| CHECK-05 | validation | 3 | focused、lint、tsc、build+production smoke、#26 安全 UAT/checker | BUNDLE-03, DOCS-04 | 否 |

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "sourceArtifact": "implement.md",
  "summary": "Replace cross-bundle production handler identity comparison with stable production-kind readiness, add source and real instrumentation-to-webhook production regressions, and verify dead-owner lease recovery without mutating the real #26 job.",
  "strategy": "Implement the minimal readiness contract and independent temporary lease-recovery coverage first; then update the built double-entry smoke and documentation in parallel; finish behind a build/runtime/UAT checker barrier.",
  "maxConcurrency": 2,
  "scheduler": {
    "mode": "dag",
    "failFast": true,
    "defaultFailurePolicy": "block_dependents"
  },
  "subtasks": [
    {
      "id": "READY-01",
      "title": "Make production handler readiness stable across Next bundles",
      "phase": "core",
      "order": 1,
      "dependsOn": [],
      "relation": "parallel",
      "parallelGroup": "core-recovery",
      "files": [
        "lib/github-automation-scheduler.ts",
        "scripts/test-github-automation-gia03.mjs"
      ],
      "instructions": [
        "Add a focused regression that seeds the shared handler registry with kind=production and a callable foreign function that is not the current module's githubIssueAnalysisJobHandler.",
        "Change isGithubAutomationProductionHandlerReady so production readiness uses the stable production kind plus availability of the current bundle's static handler, never strict equality with registration.handler.",
        "Keep getGithubAutomationJobHandler selecting the current bundle's statically imported githubIssueAnalysisJobHandler for production/default/none and selecting only explicit callable custom overrides from the registry.",
        "Preserve productionReadinessDisabled zero-lease behavior, custom override behavior, reset behavior, and readiness checks before tick/lease/attempt/job_started.",
        "Update nearby comments to explain the Next multi-entry bundle boundary without naming concrete chunk or Webpack module ids."
      ],
      "acceptance": [
        "A foreign production function reference is ready, but is not selected for execution; the local static analysis handler is selected.",
        "Callable custom remains ready and selected.",
        "Readiness-disabled tick starts zero jobs, consumes zero attempts, writes no lease owner and emits no job_started.",
        "No webhook, lease store, runner, job schema or API code changes are needed.",
        "npm run test:github-automation passes the GIA-03 readiness matrix."
      ],
      "validation": [
        "npm run test:github-automation",
        "rg -n '=== githubIssueAnalysisJobHandler|isProductionAnalysisHandler|productionReadinessDisabled' lib/github-automation-scheduler.ts scripts/test-github-automation-gia03.mjs",
        "git diff --check"
      ],
      "risks": [
        "Over-broad readiness could accidentally execute a stale registry production function instead of the local static handler.",
        "Refactoring the registry could break custom test injection or the zero-lease isolation gate.",
        "Removing a pre-lease recheck would burn attempts during a readiness flip."
      ],
      "parallelizable": true,
      "member": "implementer",
      "priority": 1,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "LEASE-02",
      "title": "Verify stale-running recovery from a dead lease owner in temporary storage",
      "phase": "recovery-tests",
      "order": 1,
      "dependsOn": [],
      "relation": "parallel",
      "parallelGroup": "core-recovery",
      "files": [
        "scripts/test-github-automation-gia07.mjs"
      ],
      "instructions": [
        "Create a temp-only test worker that acquires a real job directory lease and exits before release, leaving owner metadata with a dead PID and an old fencing token.",
        "First prove a fresh heartbeat is not stolen using a bounded acquisition attempt; do not force-remove the lock to make this assertion pass.",
        "Age only the temporary lease heartbeat through the existing test helper and write a temporary running/attempt=1 job whose updatedAt is beyond the current stale-running threshold.",
        "Run the scheduler with a deterministic custom handler and assert stale_running_reconcile, new lease/fence, job_started, attempt=2, and a legal final disposition.",
        "Assert a write with the old fencing token is rejected after ownership changes; cleanup only the temporary agentDir.",
        "Do not change LOCK_STALE_MS, STALE_RUNNING_MS, PID/processEpoch logic, fencing, or production store code unless the test exposes an independent blocker and planning is reopened."
      ],
      "acceptance": [
        "Fresh dead-owner lock remains protected until stale age is reached.",
        "After both job and lock stale gates, the scheduler automatically recovers and takes exactly one new lease-run.",
        "Events include job_stale_reconcile and job_started; attempt advances from 1 to 2.",
        "The old fencing token cannot write after recovery.",
        "The test uses a temporary PI_CODING_AGENT_DIR and never reads or writes real #26."
      ],
      "validation": [
        "npm run test:github-automation",
        "Review child-process cleanup, env restoration and lock-path containment.",
        "Confirm the test contains no _testForceRemoveLeaseDir success shortcut."
      ],
      "risks": [
        "Child exit/finally behavior may accidentally release the fixture lease.",
        "Mixing scheduler fake time and store Date.now could create a false-positive stale test.",
        "A slow CI host can make too-tight acquisition windows flaky."
      ],
      "parallelizable": true,
      "member": "implementer",
      "priority": 1,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "BUNDLE-03",
      "title": "Exercise built instrumentation then built webhook route in one production runtime",
      "phase": "production-test",
      "order": 2,
      "dependsOn": [
        "READY-01"
      ],
      "relation": "parallel",
      "parallelGroup": "bundle-docs",
      "files": [
        "scripts/test-github-automation-production-runtime.mjs"
      ],
      "instructions": [
        "Extend or replace the single jobs Retry route scenario so the test first requires .next/server/instrumentation.js, executes its Node register path, and only then requires the built github-automation webhook route.",
        "Create an enabled temp config, test webhook secret and allowlisted issue fixture; generate a real sha256 HMAC and invoke the route userland POST for human issues.opened.",
        "Use a malformed repository full name that passes ingress but deterministically blocks inside the real analysis handler before network; obtain jobId from the 202 response and poll its temp durable record/events.",
        "Assert attempt increases, job_started exists, the real handler produces malformed_full_name, and neither scheduler state nor events show analysis_handler_initialization_failed, handler_not_ready, or default_handler_defensive_fallback.",
        "Keep fetch forbidden, HOME/USERPROFILE/PI_CODING_AGENT_DIR isolated and restored, operator-path probes absent, and cleanup best-effort in finally.",
        "Do not reference generated chunk filenames, numeric module ids, source jiti imports, or static bundle string matches."
      ],
      "acceptance": [
        "The smoke fails on the reproduced 0.8.11 cross-bundle identity bug and passes with READY-01.",
        "The actual entry order is instrumentation register before webhook route load and POST.",
        "Webhook returns 202 enqueued and the job obtains a production lease/job_started in bounded time.",
        "Network attempts remain zero and no operator agentDir path is written.",
        "The smoke remains valid whether Next duplicates or deduplicates scheduler chunks."
      ],
      "validation": [
        "npm run build",
        "npm run test:github-automation-production-runtime",
        "Review .next entry usage and absence of chunk/module-id assumptions."
      ],
      "risks": [
        "Built instrumentation export shape may differ from source and must be inspected rather than guessed.",
        "Instrumentation startup timers can race webhook setup unless the test waits on stable observable state.",
        "Using a valid repository full name could accidentally reach mocked-forbidden network and obscure handler selection."
      ],
      "parallelizable": true,
      "member": "implementer",
      "priority": 2,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "DOCS-04",
      "title": "Document bundle-stable readiness and safe dead-lease recovery",
      "phase": "docs",
      "order": 2,
      "dependsOn": [
        "READY-01",
        "LEASE-02"
      ],
      "relation": "parallel",
      "parallelGroup": "bundle-docs",
      "files": [
        "docs/architecture/overview.md",
        "docs/integrations/README.md",
        "docs/modules/library.md",
        "docs/operations/troubleshooting.md",
        "docs/standards/code-style.md"
      ],
      "instructions": [
        "Clarify that production readiness uses stable registration kind across duplicated Next entry bundles while each bundle executes its own statically imported analysis handler.",
        "Update the production runtime gate description to require built instrumentation then built webhook route and no network/operator writes.",
        "Add a troubleshooting runbook for delivery_enqueued plus queued/attempt=0 and for running with a dead owner: inspect safe state, restart fixed binary, wait stale-running/lease gates, never hand-edit job or delete lock, and escalate if bounded recovery fails.",
        "Document the focused and build-gated test commands; remove directly related stale GitHub automation test wording where encountered.",
        "Do not change AGENTS.md or API/frontend docs because navigation, routes, wire contracts and UI do not change."
      ],
      "acceptance": [
        "Architecture and library maps no longer imply production readiness depends on cross-bundle function identity.",
        "Production gate documentation names the two built entry points and remains independent of generated chunk names.",
        "Troubleshooting explicitly forbids manual real-job/lock mutation and explains both stale thresholds/fencing.",
        "No UI prototype, API schema, migration or new operator force-unlock control is documented."
      ],
      "validation": [
        "rg -n 'production handler|readiness|production-runtime|stale.running|hand.edit|delete.*lock|删除.*lock' docs/architecture/overview.md docs/integrations/README.md docs/modules/library.md docs/operations/troubleshooting.md docs/standards/code-style.md",
        "git diff --check",
        "Review docs against the final scheduler/store constants and test entry sequence."
      ],
      "risks": [
        "Docs may overstate kind as authorization rather than a mode token whose execution still uses the local static handler.",
        "A runbook that suggests force deletion would bypass fencing and create duplicate side effects.",
        "Hard-coding current chunk ids would make documentation stale after the next build."
      ],
      "parallelizable": true,
      "member": "implementer",
      "priority": 2,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "CHECK-05",
      "title": "Run integrated regression, production build gate and #26 safe UAT",
      "phase": "validation",
      "order": 3,
      "dependsOn": [
        "BUNDLE-03",
        "DOCS-04"
      ],
      "relation": "barrier",
      "files": [],
      "instructions": [
        "Run focused GitHub automation tests, lint, TypeScript and diff checks; then use the wrapped npm run build and production-runtime smoke as a release validation, never bare next build.",
        "Checker reviews the exact readiness truth table, local static handler selection, disabled/custom behavior, built-entry ordering, temp isolation, dead-owner gates and old-fence rejection.",
        "For production UAT only after approved fix is released: restart the fixed binary, verify the old #26 owner PID is dead/read-only, wait existing stale thresholds, and observe job_stale_reconcile plus a new job_started/attempt without modifying job or lock.",
        "After #26 recovery, create two controlled test Issues in sequence so the second proves webhook bundle timer takeover remains healthy; record only safe ids/status/reason/time, not Issue body, credentials, paths or full fence.",
        "If #26 does not recover after thresholds and reasonable scheduling time, stop and report a blocker; do not force unlock, retry by editing state, downgrade to 0.8.11 as a fix, commit, push or merge."
      ],
      "acceptance": [
        "npm run test:github-automation, lint and tsc pass or unrelated pre-existing failures are isolated with evidence.",
        "npm run build and npm run test:github-automation-production-runtime pass on a fresh wrapped build.",
        "No production code outside approved scheduler scope and no UI/API/schema/store algorithm changes are present.",
        "#26 either recovers through durable stale reconciliation with attempt>1 or is reported as a blocker without destructive intervention.",
        "Two post-release Issues obtain lease/job_started after webhook route has loaded."
      ],
      "validation": [
        "npm run test:github-automation",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "git diff --check",
        "npm run build",
        "npm run test:github-automation-production-runtime",
        "Production read-only #26 recovery observation and two-Issue UAT"
      ],
      "risks": [
        "Build validation changes .next and can interfere with a running dev server; schedule it as a release gate.",
        "Live UAT requires operator credentials/network and can create real comments; use the designated test repository/App and approved window.",
        "PID reuse or a live owner can intentionally delay stale lock removal; fail closed rather than bypassing it.",
        "An unrelated provider/GitHub outage can block final UAT without invalidating the local readiness fix."
      ],
      "parallelizable": false,
      "member": "checker",
      "priority": 3,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    }
  ],
  "execution": {
    "mode": "mixed",
    "maxParallel": 2,
    "groups": [
      {
        "id": "core-recovery",
        "title": "Readiness core and independent recovery proof",
        "relation": "parallel",
        "subtaskIds": [
          "READY-01",
          "LEASE-02"
        ]
      },
      {
        "id": "bundle-docs",
        "title": "Built-entry regression and documentation",
        "relation": "parallel",
        "dependencies": [
          "core-recovery"
        ],
        "subtaskIds": [
          "BUNDLE-03",
          "DOCS-04"
        ]
      },
      {
        "id": "closeout",
        "title": "Integrated checker and production UAT",
        "relation": "barrier",
        "dependencies": [
          "bundle-docs"
        ],
        "subtaskIds": [
          "CHECK-05"
        ]
      }
    ]
  }
}
```

## 验证命令

```bash
npm run test:github-automation
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check

# 仅作为本修复的 production/release gate；禁止 bare next build
npm run build
npm run test:github-automation-production-runtime
```

## 检查门禁

- `READY-01` 与 `LEASE-02` 可并行，最大并发 2；各自必须 local review。
- `BUNDLE-03` 在 readiness 修复后执行；`DOCS-04` 在 readiness/recovery 契约稳定后执行。
- `CHECK-05` 是 barrier，必须由 checker 完成。
- production smoke 未按 `instrumentation → webhook` built-entry 顺序执行，视为门禁未覆盖。
- #26 未通过自动 stale reconcile 恢复时必须报告 blocker，不能用删 lock、改 job、伪造 event 让检查通过。
- 任何 UI、API、schema、lease 算法/阈值或强制解锁能力改动都必须停止并回到 planning。
- 主会话保存 implementationPlan 并取得用户对 `plan-review.md` 的明确批准前，不得进入 implementing。

## 回滚

- 代码可回滚 readiness 与测试/文档，无数据迁移。
- 回滚旧 readiness 会重新暴露该故障；不得将旧版重启当作长期止血。
- 紧急停止新分析使用既有 `paused=true`/`enabled=false`，保留 job/delivery/event/lock。
- 不删除 #26 或其他历史 job/lock，不降级 schema，不重写 attempt/fence。
