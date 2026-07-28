# Implement — GitHub automation retry/runtime/bootstrap

## 1. 执行原则

- 用户批准 [plan-review.md](plan-review.md) 前不得改生产代码。
- 先并行完成 handler readiness 与 bootstrap typed outcome；再做完整控制流测试。
- 自动测试、lint、tsc 只是 30142 真实验收的前置门禁，不是结案条件。
- 不修改 Issue #22 业务功能，不创建 g2，不删 history，不重置 attempt，不跳 policy。
- 不 commit、push、merge；server publisher 不在本任务验收中触发。

## 2. 实现前优先阅读

| 顺序 | 文件 | 重点 |
| --- | --- | --- |
| 1 | [brief.md](brief.md)、[prd.md](prd.md)、[design.md](design.md)、[checks.md](checks.md) | 现场证据、契约、最终门禁 |
| 2 | `lib/github-automation-runtime.ts` | webhook-only handler ensure |
| 3 | `lib/github-automation-scheduler.ts` | registry/default/tick/disposition/attempt |
| 4 | `lib/github-issue-triage-runner.ts` | full handler/continuation/registration |
| 5 | `lib/github-automation-projection.ts`、`app/api/github-automation/jobs/[jobId]/route.ts` | manual action + safe projection |
| 6 | `lib/github-automation-runner.ts` | bootstrap catch、retry、same-generation reconcile |
| 7 | `lib/github-automation-session.ts`、`lib/agent-session-bootstrap.ts`、`lib/rpc-manager.ts` | Session create 与 error boundary |
| 8 | `lib/github-automation-types.ts`、`lib/github-automation-store.ts` | disposition/observability/persistence |
| 9 | GitHub automation focused scripts | test harness 与 privacy sentinel |
| 10 | `docs/architecture/overview.md`、`docs/operations/troubleshooting.md`、`docs/modules/{api,frontend,library}.md` | 文档不漂移 |

## 3. 人类可读子任务表

| ID | Phase | 标题 | dependsOn | 并行/评审 |
| --- | --- | --- | --- | --- |
| GHR-01 | runtime | handler registry/readiness 与所有入口闭环 | — | 可与 02 并行；checker local review |
| GHR-02 | bootstrap | typed bootstrap error、显式 disposition、success event | — | 可与 01 并行；checker local review |
| GHR-03 | tests | action→scheduler→runner fault injection 与 #22-shape回归 | 01,02 | 串行整合 |
| GHR-04 | acceptance-prep | 30142 安全验收脚本/证据模板（不执行现场retry） | 01,02 | 可与 03 并行 |
| GHR-05 | verify/docs | 文档、全量自动验证、checker | 03,04 | 收尾前置 |
| GHR-06 | real-acceptance | 30142 真实 pause→单次retry→Session proof | 05 | 独立最终门禁；checker/operator |

建议 `maxConcurrency=2`：GHR-01/02 并行；完成后 GHR-03/04 并行；GHR-05、GHR-06 串行。

## 4. 验证命令

```bash
npm run test:github-automation
npm run test:github-unattended
npm run test:github-unattended-runner
npm run test:github-publish-policy
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

最终 RC：

```bash
npm run build
node bin/pi-web.js --port 30142 --no-open
```

禁止直接 `next build`。

## 5. 评审门禁

- GHR-01：冷进程无 webhook 的 manual retry 也必须 full handler ready。
- GHR-02：actual catch/disposition 测试，不能只手工构造 projection。
- GHR-03：known failure reason 不得变成 runner_no_progress。
- GHR-04：脚本默认 read-only；真实 mutation 必须显式一次性确认。
- GHR-05：docs 与 API/runtime truth一致，UI component/CSS 无改动。
- GHR-06：30142 真实成功；任何失败都返回 blocker，不得标 done。

## 6. 回滚

- 代码回滚不迁移/删除 durable data。
- 现场 stop-bleed 用 per-job pause，必要时 global paused。
- 保留新增 safe events；旧版本忽略 additive meta。
- 不恢复/重写历史 attempt，不删除 #22 WorkTree/task/session/events。

---

## Implementation Plan (machine-readable)

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "summary": "Close the GitHub automation manual retry path by making the full handler runtime-ready at every scheduler entry, preserving typed Session bootstrap outcomes through explicit dispositions, and requiring a real same-generation Session proof on port 30142.",
  "strategy": "Implement handler readiness and bootstrap observability in parallel, integrate them with real control-flow fault tests, prepare a safe 30142 acceptance harness, pass full static/focused checks, then run one real production-shaped retry as an independent final gate.",
  "maxConcurrency": 2,
  "sourceArtifact": "implement.md",
  "execution": {
    "mode": "mixed",
    "maxParallel": 2,
    "groups": [
      {
        "id": "core-parallel",
        "title": "runtime and bootstrap core",
        "relation": "parallel",
        "dependencies": [],
        "subtaskIds": ["GHR-01", "GHR-02"]
      },
      {
        "id": "integration-parallel",
        "title": "tests and acceptance preparation",
        "relation": "parallel",
        "dependencies": ["GHR-01", "GHR-02"],
        "subtaskIds": ["GHR-03", "GHR-04"]
      },
      {
        "id": "quality-gate",
        "title": "documentation and automated quality gate",
        "relation": "serial",
        "dependencies": ["GHR-03", "GHR-04"],
        "subtaskIds": ["GHR-05"]
      },
      {
        "id": "real-acceptance",
        "title": "port 30142 real acceptance",
        "relation": "serial",
        "dependencies": ["GHR-05"],
        "subtaskIds": ["GHR-06"]
      }
    ]
  },
  "subtasks": [
    {
      "id": "GHR-01",
      "title": "Make full GitHub automation handler readiness authoritative at every scheduler entry",
      "phase": "runtime",
      "order": 10,
      "dependsOn": [],
      "dependencies": [],
      "relation": "parallel",
      "files": [
        "lib/github-automation-scheduler.ts",
        "lib/github-automation-runtime.ts",
        "lib/github-issue-triage-runner.ts",
        "lib/github-automation-projection.ts",
        "app/api/github-automation/jobs/[jobId]/route.ts",
        "lib/github-automation-handler-runtime.ts"
      ],
      "instructions": [
        "Introduce one process-global, concurrency-safe handler readiness boundary owned by or verified against the scheduler registry. The final file name may change, but there must be one authority.",
        "Record and verify handler kind plus registry generation; do not trust the webhook runtime's private _triageHandlerRegistered boolean after HMR or test reset.",
        "Use a lazy/dynamic import or another cycle-safe mechanism to register githubIssueTriageJobHandler, and ensure a rejected initialization can retry after bounded backoff instead of permanently caching a rejected promise.",
        "Require readiness from webhook accept, manual retry/resume before queue mutation, scheduler ensure/wake paths, and tick as the final defensive gate. Any future server-boot ensure must call the same boundary.",
        "When readiness fails, surface handler_not_ready with allowlisted load/register/verify stage and retryability, do not take a business lease, do not increment attempt, and append a deduplicated path-free safe event.",
        "Keep defaultJobHandler only for explicit isolated tests/GHA-02 compatibility. A production planning job must never return unchanged through the default handler; defensive fallback must be handler_not_ready, not runner_no_progress.",
        "Preserve pure status/config GET side-effect rules: they must not wake the scheduler. Only action/webhook/startup processing paths ensure readiness for execution.",
        "Do not add UI fields or modify GithubAutomationConfig in this subtask."
      ],
      "acceptance": [
        "A cold process with no webhook can execute Settings retry/resume using the full triage/unattended handler.",
        "Concurrent ensure calls are idempotent and registry verification survives reset/HMR semantics.",
        "Handler initialization failure is handler_not_ready, never runner_no_progress, and attempt does not increment before readiness.",
        "Direct scheduler tick cannot process a production job with the default handler.",
        "Safe event/API data contains no module specifier, stack, absolute path, or secret."
      ],
      "validation": [
        "npm run test:github-automation",
        "npm run test:github-unattended",
        "node_modules/.bin/tsc --noEmit",
        "npm run lint"
      ],
      "risks": [
        "A scheduler/triage-runner import cycle can create a false ready state if verification is based on module booleans rather than the live registry.",
        "Unbounded readiness retries can replace the old attempt spin with timer/event spam.",
        "Tests that intentionally exercise default handlers need explicit overrides and must not weaken production gates."
      ],
      "parallelizable": true,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "GHR-02",
      "title": "Preserve typed Session bootstrap failures and explicit scheduler dispositions",
      "phase": "bootstrap",
      "order": 20,
      "dependsOn": [],
      "dependencies": [],
      "relation": "parallel",
      "files": [
        "lib/agent-session-bootstrap.ts",
        "lib/github-automation-session.ts",
        "lib/github-automation-runner.ts",
        "lib/github-automation-types.ts",
        "lib/github-automation-errors.ts"
      ],
      "instructions": [
        "Extend the bootstrap boundary with stable typed codes/stages/retryability for binding invalid, worktree missing, project space missing/archive, path mismatch, runtime module missing, runtime start failure, index update failure, and unknown failure.",
        "Classify from project-owned typed errors and Node cause codes before sanitization. Never classify by regex over safeGithubAutomationErrorMessage output.",
        "Map MODULE_NOT_FOUND to a fixed session_runtime_module_missing category without returning the missing specifier, build-host path, cause text, or stack.",
        "Return explicit retry_due disposition for transient bootstrap failures and explicit blocked disposition for hard failures, with blockedAtLayer=session_bootstrap and a stable main reasonCode.",
        "Persist allowlisted safe event meta containing bootstrapCode, stage, retryable, and a fixed safe message. Do not emit generic Internal GitHub automation error as the only diagnostic.",
        "On success, persist runner Session references, advance existing independent Agent/meaningful-progress counters, and append a path-free unattended_session_created event.",
        "Define cleanup for a partially created wrapper/Session versus best-effort project-space candidate index writes. JSONL remains truth and no live orphan wrapper may be reported as Session none.",
        "Audit known unattended stop branches so incomplete_claim, policy blocks, implementer retry, and bootstrap outcomes return an explicit disposition and cannot be folded into runner_no_progress.",
        "Keep attempt semantics unchanged: only scheduler lease acquisition increments it; retry/reconcile never resets it."
      ],
      "acceptance": [
        "Actual bootstrap catch paths expose stable typed categories and fixed safe messages.",
        "Scheduler post-processing preserves session_bootstrap_failed or session_bootstrap_transient and never rewrites it to runner_no_progress.",
        "Success creates a safe positive Session event and updates agentRunCount/progressRevision/meaningfulProgress independently of attempt.",
        "Runner state remains same-generation and retains WorkTree/task/project/space on failure.",
        "No path, sessionFile, module specifier, stack, or secret crosses safe projection/event boundaries."
      ],
      "validation": [
        "npm run test:github-unattended-runner",
        "npm run test:github-unattended",
        "node_modules/.bin/tsc --noEmit",
        "npm run lint"
      ],
      "risks": [
        "Destroying a partial Session too aggressively could remove valid JSONL truth; preserving it without destroying the wrapper could leak a live process-local session.",
        "Treating all ENOENT errors alike can misclassify a deterministic bundle problem as transient.",
        "Changing runner checkpoint vocabulary requires updating every recovery and projection consumer."
      ],
      "parallelizable": true,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "GHR-03",
      "title": "Add full action-to-scheduler-to-runner fault-injection and #22-shaped regressions",
      "phase": "tests",
      "order": 30,
      "dependsOn": ["GHR-01", "GHR-02"],
      "dependencies": ["GHR-01", "GHR-02"],
      "relation": "parallel",
      "files": [
        "scripts/test-github-automation.mjs",
        "scripts/test-github-unattended.mjs",
        "scripts/test-github-unattended-runner.mjs",
        "scripts/test-github-handler-runtime.mjs",
        "scripts/test-github-session-bootstrap.mjs",
        "package.json"
      ],
      "instructions": [
        "Add focused scripts only if they improve isolation; otherwise extend the existing suites without creating duplicate test truth.",
        "Test cold manual retry after registry reset with no webhook and assert the real full handler is registered before tick.",
        "Fault handler load/register/verify and assert handler_not_ready, no attempt increment, no default processing, no runner_no_progress, bounded safe events, and retry recovery.",
        "Fault the actual bootstrap dependency inside runGithubUnattendedImplementation for binding, module-missing, transient runtime, and hard unknown errors. Do not only construct a final job projection fixture.",
        "Pass returned results through scheduler disposition application and assert the original known reason/layer/status survives.",
        "Add bootstrap success coverage for safe session-created event, runner Session refs, WorkTree project/space header binding, and independent counters.",
        "Create a sanitized #22-shaped g1 fixture with attempt=900, studio_task_ready, consumed remote command, WorkTree/task/space, and no Session; run the actual action/readiness/tick/runner path without a custom no-op handler.",
        "Retain privacy sentinel assertions for App/machine credentials and add absolute path/module specifier/stack sentinels.",
        "Keep all automated tests on temporary PI_CODING_AGENT_DIR with mocked network; never mutate the operator's real #22."
      ],
      "acceptance": [
        "Tests fail on the current webhook-only registration and generic bootstrap behavior, then pass with GHR-01/02.",
        "Known failures never become runner_no_progress after scheduler post-processing.",
        "The #22-shaped fixture stays generation 1, preserves attempt, and reaches success evidence or a typed stable failure in finite ticks.",
        "No test touches real GitHub, operator credentials, or the real agent directory.",
        "New package scripts and existing GitHub automation suites pass."
      ],
      "validation": [
        "npm run test:github-automation",
        "npm run test:github-unattended",
        "npm run test:github-unattended-runner",
        "npm run test:github-publish-policy",
        "npm run test:github-handler-runtime",
        "npm run test:github-session-bootstrap"
      ],
      "risks": [
        "Module-cache reset tests can pass accidentally unless they verify the live scheduler registry kind.",
        "Short timer assertions are flaky; assert durable terminal/backoff state instead of exact milliseconds.",
        "A fixture-only success can still miss production bundling, so GHR-06 remains mandatory."
      ],
      "parallelizable": true,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "GHR-04",
      "title": "Prepare a safe direct-port 30142 acceptance harness and evidence template",
      "phase": "acceptance-prep",
      "order": 40,
      "dependsOn": ["GHR-01", "GHR-02"],
      "dependencies": ["GHR-01", "GHR-02"],
      "relation": "parallel",
      "files": [
        "scripts/verify-github-automation-30142.mjs",
        "package.json",
        ".ypi/tasks/20260727-125847-修复-github-自动化手动重试空跑-handler-未注册-bootstrap-失败不可见-/checks.md"
      ],
      "instructions": [
        "Create an operator-safe harness or command guide that targets an explicit base URL defaulting to http://localhost:30142 and an explicit jobId.",
        "Default mode must be read-only: verify direct health PID, no HTTP 301/302 redirect, runtime provenance, job baseline, and current pause/session/generation state.",
        "Any mutation mode must require an explicit exact confirmation flag, perform at most one retry POST, never loop retries, and print a bounded safe evidence summary.",
        "The harness must not read or print credentials, absolute WorkTree/session paths, raw Issue/comment bodies, prompts, transcripts, or arbitrary event meta.",
        "Provide polling with a hard timeout and success/failure predicates matching checks.md: Session-created evidence is required; explicit handler/bootstrap errors are diagnostics but fail the final gate.",
        "Do not run the real retry in this subtask. Only test the harness against mocked/local fixture endpoints or dry-run parsing.",
        "Keep manual commands in checks.md as a fallback so the final gate is not dependent on a brittle script."
      ],
      "acceptance": [
        "The default harness cannot mutate a job.",
        "Mutation requires explicit operator acknowledgement and sends no more than one retry.",
        "PID/processEpoch/codeRevision and direct port attribution are included in evidence.",
        "Success requires same generation plus real Session evidence; handler/bootstrap/no-progress/generic error returns non-zero.",
        "No HTTP redirect or second ypi process can be silently accepted as port 30142 proof."
      ],
      "validation": [
        "node scripts/verify-github-automation-30142.mjs --help",
        "node scripts/verify-github-automation-30142.mjs --dry-run --job-id job_example --base-url http://localhost:30142",
        "node_modules/.bin/tsc --noEmit",
        "npm run lint"
      ],
      "risks": [
        "An overly automatic harness could accidentally retry a production job; read-only default and exact confirmation are mandatory.",
        "Local event-file access can leak paths; prefer API evidence and allowlisted event fields only.",
        "Redirect-following fetch defaults can falsely attribute a response to 30142; redirects must be manual/rejected."
      ],
      "parallelizable": true,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "GHR-05",
      "title": "Update architecture/runbook/module docs and pass the complete automated quality gate",
      "phase": "verify-docs",
      "order": 50,
      "dependsOn": ["GHR-03", "GHR-04"],
      "dependencies": ["GHR-03", "GHR-04"],
      "relation": "serial",
      "files": [
        "docs/architecture/overview.md",
        "docs/operations/troubleshooting.md",
        "docs/integrations/github-app-automation-setup.md",
        "docs/modules/api.md",
        "docs/modules/library.md",
        "docs/modules/frontend.md",
        "AGENTS.md"
      ],
      "instructions": [
        "Document one handler readiness boundary, production prohibition on silent default handler use, handler_not_ready semantics, and lease-before-attempt ordering.",
        "Document typed bootstrap code/stage/retryability, explicit disposition preservation, safe positive Session event, and privacy exclusions.",
        "Replace the old runbook-only completion implication with the mandatory 30142 real acceptance gate for this regression class, while keeping ordinary operator recovery safe.",
        "Update API/library maps for changed action/readiness/runtime behavior and any new helper/script. State explicitly that GithubAutomationConfig UI structure did not change.",
        "Only update AGENTS.md if a new major module needs top-level navigation; keep detailed material in docs.",
        "Run every focused GitHub automation suite, lint, typecheck, and diff check. Review all reason-code consumers and docs before changing shared constants.",
        "Have checker verify PRD R1-R11, privacy boundaries, same-generation semantics, no UI scope expansion, and GHR-06 readiness.",
        "Do not claim completion or transition beyond checking if GHR-06 has not run successfully."
      ],
      "acceptance": [
        "Docs, code, tests, and runbook describe the same handler/bootstrap/disposition behavior.",
        "All focused suites, lint, typecheck, and diff check pass.",
        "No production UI component or CSS change was introduced; otherwise the task returns to UI approval.",
        "Checker approves the implementation for real 30142 acceptance, not for release completion.",
        "No unrelated user changes are overwritten."
      ],
      "validation": [
        "npm run test:github-automation",
        "npm run test:github-unattended",
        "npm run test:github-unattended-runner",
        "npm run test:github-publish-policy",
        "npm run test:github-handler-runtime",
        "npm run test:github-session-bootstrap",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "git diff --check"
      ],
      "risks": [
        "Passing offline suites can create false confidence if reviewers treat GHR-05 as completion.",
        "Reason-code documentation can drift if bootstrap mapper and projection are changed independently.",
        "A broad AGENTS.md update would duplicate detailed docs and increase maintenance burden."
      ],
      "parallelizable": false,
      "member": "checker",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "GHR-06",
      "title": "Run the mandatory real #22-shaped pause-to-single-retry acceptance on port 30142",
      "phase": "real-acceptance",
      "order": 60,
      "dependsOn": ["GHR-05"],
      "dependencies": ["GHR-05"],
      "relation": "serial",
      "files": [
        ".ypi/tasks/20260727-125847-修复-github-自动化手动重试空跑-handler-未注册-bootstrap-失败不可见-/checks.md",
        ".ypi/tasks/20260727-125847-修复-github-自动化手动重试空跑-handler-未注册-bootstrap-失败不可见-/handoff.md",
        ".ypi/tasks/20260727-125847-修复-github-自动化手动重试空跑-handler-未注册-bootstrap-失败不可见-/review.md"
      ],
      "instructions": [
        "Use the real job job_1278854433_22_g1_01a6cdde when safe; otherwise obtain explicit main-session/operator confirmation for a named same-shape production job. Never create a fixture and call it real acceptance.",
        "Pause the job first and record baseline jobId, generation, attempt, phase/checkpoint, safe runner binding, and event boundary. Do not edit JSON or create g2.",
        "Build via npm run build, never direct next build. Stop or isolate every other ypi scheduler sharing the same PI_CODING_AGENT_DIR so the result is attributable only to the port 30142 process.",
        "Start node bin/pi-web.js --port 30142 --no-open and verify lsof PID, /api/cli/health PID, and /api/github-automation/status runtimeProvenance including processEpoch and codeRevision. Reject HTTP 301/302 redirection.",
        "Send exactly one retry POST to the 30142 single-job endpoint after stable pause. Do not loop, double-click, or pair resume plus retry.",
        "Poll only GET endpoints and allowlisted safe events. Require retry_wake, job_started, unattended_implementing, and positive unattended_session_created or equivalent real Session proof.",
        "Cross-check single-job/status projections, runner sessionId, agentRuns/meaningful progress, and the Session JSONL header projectId+spaceId in the WorkTree space. Keep jobId, generation 1, WorkTree, branch, task, and history unchanged; attempt must not reset or empty-spin.",
        "If handler_not_ready, any session_bootstrap failure, runner_no_progress, generic Internal GitHub automation error, missing Session, provenance mismatch, redirect, g2, or attempt spin occurs, stop and mark this subtask failed. Do not claim the fix.",
        "After successful Session evidence, immediately request per-job pause to keep the business implementation of Issue #22 outside this task. Preserve all audit and do not review/merge/publish the business diff.",
        "Record only safe evidence in review/handoff: PID/provenance, job/generation, attempt baseline/final, event kinds/reason codes, Session short id/availability, same-generation checks, and post-proof pause. Never record paths or credentials."
      ],
      "acceptance": [
        "A release-candidate process directly listens on http://localhost:30142 and is the only shared-agent-dir scheduler handling the job.",
        "Exactly one retry advances the same generation through the full handler to a real WorkTree Session.",
        "Status API, job API, safe events, runner state, and Session header all agree; sessionAvailability is active or ended and agentRuns is at least one.",
        "No runner_no_progress, handler/bootstrap failure, generic hidden error, attempt reset/spin, policy skip, history deletion, or g2 occurs.",
        "The job is paused again after proof, and no Issue #22 business change is merged or published by this task.",
        "Only this successful evidence permits the checker/main session to state that the regression is fixed."
      ],
      "validation": [
        "npm run build",
        "lsof -nP -iTCP:30142 -sTCP:LISTEN",
        "curl -fsS http://localhost:30142/api/cli/health",
        "curl -fsS http://localhost:30142/api/github-automation/status",
        "node scripts/verify-github-automation-30142.mjs --job-id job_1278854433_22_g1_01a6cdde --base-url http://localhost:30142 --confirm-single-retry",
        "Manual cross-check of checks.md section 4 and post-proof pause"
      ],
      "risks": [
        "Running 30141 and 30142 against the same agent directory can make attribution invalid even with job leases.",
        "The real policy may correctly block Issue #22; this is a failed acceptance, not permission to skip policy.",
        "Once Session starts, the full agent can create business changes quickly; pause immediately after proof and never merge/publish them here."
      ],
      "parallelizable": false,
      "member": "checker",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    }
  ]
}
```
