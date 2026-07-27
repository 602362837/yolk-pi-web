# Implement：GitHub Bot 自循环与 Owner 指令闭环

## 先阅读

1. `AGENTS.md`
2. `docs/integrations/github-app-automation-setup.md`
3. `docs/integrations/README.md`（GitHub App automation）
4. `docs/architecture/overview.md`（GitHub automation / Studio unattended boundaries）
5. `docs/modules/api.md`、`docs/modules/library.md`
6. `docs/standards/code-style.md`
7. `lib/github-automation-runtime.ts`
8. `lib/github-automation-store.ts`
9. `lib/github-issue-triage-runner.ts`
10. `lib/github-automation-comments.ts`
11. `lib/github-owner-intent.ts`
12. `lib/github-automation-runner.ts`
13. `lib/github-automation-scheduler.ts`
14. `scripts/test-github-automation.mjs`、`scripts/test-github-unattended*.mjs`
15. 本任务 `brief.md`、`prd.md`、`ui.md`、`design.md`、`checks.md`

## 人类可读子任务表

| ID | 阶段 | 顺序 | 内容 | 依赖 | 可并行 |
| --- | --- | ---: | --- | --- | --- |
| UI-00 | design-gate | 0 | ui-designer 产出 GitHub Issue timeline HTML，用户确认 command target/命令集/closed 策略并批准 | — | 否 |
| LOOP-01 | ingestion | 1 | safe envelope、self/Bot source classifier、event/action matrix、generation gate、closed reconciliation | UI-00 | 否 |
| IDEMP-02 | idempotency | 2 | comment version durable contract、stable marker v2、no-op PATCH、unknown-outcome reconcile | LOOP-01 | 否 |
| CMD-03 | command | 3 | exact Owner command parser/dispatcher、parked state、receipt/status、per-job retry/pause/continue | IDEMP-02 | 否 |
| TEST-04 | tests | 4 | 100 次 self-edited、action matrix、exact comment、crash/replay、no-injection regression | CMD-03 | 是 |
| DOC-05 | docs | 4 | 更新架构/API/library/setup/troubleshooting 与 operator 协议 | CMD-03 | 是 |
| CHECK-06 | validation | 5 | focused suites、lint、tsc、paused-safe smoke、checker 评审 | TEST-04, DOC-05 | 否 |

## 实施原则

- 先在 webhook 入口止环，再实现用户命令；不得用“只在 runner 忽略”代替入口零 job/零 wake。
- App identity 不以 login 字符串作为唯一依据；使用 `performed_via_github_app.id` 强匹配 + sender type 保守 fallback。
- self/Bot delivery 仍保留 safe audit；“忽略”不等于丢弃 delivery。
- generation 只能由明确生命周期/结构化 retry 改变，不能由任意 delivery 改变。
- canonical comment identity 不含 trace/time/phase；trace 只留本地 audit。
- command worker 只 GET exact comment id 并校验 version/hash；禁止扫描任意最近肯定评论。
- 评论 parser 只输出枚举 command，不输出自由文本到 agent。
- Issue comment 绝不能解除 global paused，也不能改 validation/branch/remote/publisher/policy。
- 不重写/删除历史 g1–g80；不修改生产 React UI。若 status API/UI 需要新增展示，重新走 UI 门禁。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "updatedAt": "2026-07-24T12:40:00Z",
  "sourceArtifact": "implement.md",
  "summary": "Stop GitHub App self-authored webhook feedback at ingestion, make comment and generation effects durable/idempotent, then add an exact-owner-comment command receipt/status loop without allowing Issue text to alter global pause or execution policy.",
  "strategy": "Complete the user-visible GitHub timeline HTML gate first. Implement ingress source/action filtering before remote comment idempotency, then build the owner command protocol on exact comment versions. Run tests and docs in parallel, and finish with paused-safe validation plus checker review.",
  "maxConcurrency": 2,
  "scheduler": {
    "mode": "dag",
    "failFast": true,
    "defaultFailurePolicy": "block_dependents"
  },
  "subtasks": [
    {
      "id": "UI-00",
      "title": "Approve the GitHub Issue command and status timeline prototype",
      "phase": "design-gate",
      "order": 0,
      "dependsOn": [],
      "relation": "serial",
      "files": [
        ".ypi/tasks/20260724-195830-修复-github-自动化评论自触发循环-并建立-开发者指令响应闭环/ui.md",
        ".ypi/tasks/20260724-195830-修复-github-自动化评论自触发循环-并建立-开发者指令响应闭环/github-issue-command-loop.html",
        ".ypi/tasks/20260724-195830-修复-github-自动化评论自触发循环-并建立-开发者指令响应闭环/plan-review.md"
      ],
      "instructions": [
        "Have the Studio ui-designer create a task-local HTML prototype that simulates the GitHub Issue timeline for triage, owner command receipt, status progression, paused, superseded, rejected, and closed states.",
        "Ask the user to decide command targeting (@AppBot or /ypi versus intercepting @machine-assignee), the Phase 1 command set, whether free-text comments can supplement requirements, and the active-job policy when an Issue closes.",
        "Record approval and the exact approved copy/interaction contract in ui.md and plan-review.md before any production-code subtask starts."
      ],
      "acceptance": [
        "A non-placeholder HTML prototype exists in the task directory and is linked from ui.md and plan-review.md.",
        "The user explicitly approves the target syntax, command set, global-versus-job pause copy, and closed-Issue behavior.",
        "No implementation begins while the UI gate is pending."
      ],
      "validation": [
        "Open the task-local HTML through the Studio preview path.",
        "Check all states listed in ui.md and record the user approval revision."
      ],
      "risks": [
        "Intercepting the machine assignee mention could hijack ordinary human communication.",
        "Ambiguous pause copy could imply that an Issue comment overrides the global kill switch."
      ],
      "parallelizable": false,
      "member": "ui-designer",
      "priority": 0,
      "localReview": { "required": true, "reviewer": "architect" }
    },
    {
      "id": "LOOP-01",
      "title": "Add safe actor/action classification and stop self-event job creation",
      "phase": "ingestion",
      "order": 1,
      "dependsOn": ["UI-00"],
      "relation": "serial",
      "files": [
        "lib/github-automation-store.ts",
        "lib/github-automation-runtime.ts",
        "lib/github-automation-types.ts",
        "lib/github-issue-triage-runner.ts"
      ],
      "instructions": [
        "Extend the verified envelope/delivery with optional senderType, commentId, commentUpdatedAt, opaque comment body SHA-256, and performedViaAppId; never persist comment text.",
        "Classify definite self by performed-via App ID and conservatively classify Bot/App senders as non-actionable. Add fixed safe ignore reasons and retain exclusive delivery audit.",
        "Implement the approved issues/issue_comment action matrix. Self/Bot and non-actionable mutations must create no job, update no active job delivery, and wake no scheduler.",
        "Replace the current terminal-any-event generation increment with an explicit generation eligibility function. Split closed/edited lifecycle reconciliation from claim/triage.",
        "Keep global paused authoritative; comment events cannot clear it."
      ],
      "acceptance": [
        "App comment create/edit and App label/assign events are audit-only with zero business side effects.",
        "A human issues.opened event creates at most one initial job; duplicate delivery stays a no-op.",
        "Closed and unrelated Issue actions do not start claim/triage or increment generation.",
        "Historical v1 store records remain readable and missing actor/comment fields fail closed."
      ],
      "validation": [
        "Run the LOOP-01 subset of scripts/test-github-automation.mjs.",
        "Inspect scheduler wake and GitHub mutation mock counts.",
        "Run eslint on changed ingestion/store files."
      ],
      "risks": [
        "Over-broad Bot handling can drop third-party bot-created issues; this is intentional for owner authorization but must be documented.",
        "Incorrect closed reconciliation could disrupt an already publishing job."
      ],
      "parallelizable": false,
      "member": "implementer",
      "priority": 1,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "IDEMP-02",
      "title": "Make canonical comments and comment versions idempotent",
      "phase": "idempotency",
      "order": 2,
      "dependsOn": ["LOOP-01"],
      "relation": "serial",
      "files": [
        "lib/github-automation-comments.ts",
        "lib/github-automation-store.ts",
        "lib/github-issue-triage-runner.ts"
      ],
      "instructions": [
        "Introduce a stable v2 marker keyed by kind/repository/issue, with a receipt marker additionally keyed by commentId; keep strict v1 read compatibility.",
        "Remove dynamic trace identity from generated comment bodies. Normalize deterministic bodies and skip PATCH when semantic body is unchanged.",
        "Add exact comment GET and version/hash verification helpers. Persist only opaque version keys/effects, never body.",
        "Reconcile POST/PATCH unknown outcomes by re-listing the exact marker/body instead of blind retry. Under duplicates, select one authority and never delete comments automatically."
      ],
      "acceptance": [
        "Same body causes zero PATCH calls even across deliveries/restarts.",
        "A trace change alone never edits a GitHub comment.",
        "Timeout after a successful remote write is recovered by marker/body read-back without a duplicate write.",
        "Marker lookup cannot reuse another repository/Issue/kind marker."
      ],
      "validation": [
        "Run canonical marker/no-op/unknown-outcome focused tests.",
        "Verify one semantic change emits exactly one PATCH and its self webhook is ignored by LOOP-01."
      ],
      "risks": [
        "A pure marker migration write can still emit one webhook; avoid migration-only edits.",
        "List-then-create races need issue lease plus remote reconcile."
      ],
      "parallelizable": false,
      "member": "implementer",
      "priority": 2,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "CMD-03",
      "title": "Implement exact Owner commands, receipts, and observable status",
      "phase": "command",
      "order": 3,
      "dependsOn": ["IDEMP-02"],
      "relation": "serial",
      "files": [
        "lib/github-owner-intent.ts",
        "lib/github-issue-triage-runner.ts",
        "lib/github-automation-runner.ts",
        "lib/github-automation-comments.ts",
        "lib/github-automation-store.ts",
        "lib/github-automation-labels.ts"
      ],
      "instructions": [
        "Implement the user-approved target/command grammar as pure parsing over stripped text, preserving owner-first authorization, negation, defer, question, quote/code, and Bot rejection rules.",
        "Bind processing to the delivery's exact comment id/author/version. Do not scan arbitrary recent comments or reuse an old affirmative comment.",
        "Use a durable command key and effect/receipt reconciliation under the issue lease so each comment version changes state at most once.",
        "Separate initial claim from re-triage. Keep needs-info in a parked communication state and let the approved re-evaluate command read only current Issue title/body.",
        "Dispatch retry/pause/continue only through existing structured runner methods. Never pass comment free text to agent/task/validation and never alter global paused.",
        "Build the approved canonical command receipt and automation status comments; update only on semantic state change and keep Bot/machine-assignee identity accurate."
      ],
      "acceptance": [
        "An owner command produces one accepted/rejected/superseded receipt with current state and next action.",
        "Non-owner, Bot, incomplete claim, closed Issue, recommendation-not-yes, policy failure, and global paused cannot authorize or advance implementation.",
        "A status query is read-only and an old adoption comment cannot be replayed by it.",
        "No raw comment text enters durable store, projections, prompt, task instructions, validation, branch, remote, or publisher config."
      ],
      "validation": [
        "Run owner actor/intent/target/command matrix tests.",
        "Run unattended retry/pause/continue tests with explicit no-comment-injection assertions.",
        "Compare rendered comments with the approved HTML prototype."
      ],
      "risks": [
        "A broad natural-language grammar can misclassify discussion as a command; keep anchored allowlists.",
        "Receipt write failure after state transition requires durable reconcile without replaying the command."
      ],
      "parallelizable": false,
      "member": "implementer",
      "priority": 3,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "TEST-04",
      "title": "Add self-loop, exact-comment, and crash/replay regression coverage",
      "phase": "tests",
      "order": 4,
      "dependsOn": ["CMD-03"],
      "relation": "parallel",
      "parallelGroup": "coverage-docs",
      "files": [
        "scripts/test-github-automation.mjs",
        "scripts/test-github-unattended.mjs",
        "scripts/test-github-unattended-runner.mjs",
        "scripts/test-github-publish-policy.mjs"
      ],
      "instructions": [
        "Add a deterministic chain with one human open, App assign/labels/comment create, and 100 App comment edits; assert deliveries persist while jobs, generation, wakes, handlers, and remote mutations do not grow.",
        "Cover performed App ID, Bot fallback, login rename, action matrix, terminal generation rules, global paused, Issue closed/reopened, and delivery replay.",
        "Cover exact comment author/version/hash, stale/superseded edits, historical affirmative comments, owner/org/non-owner/Bot matrices, and command receipt idempotency.",
        "Cover stable v1/v2 marker behavior, body no-op, unknown remote outcomes, effect crash recovery, and no comment text injection."
      ],
      "acceptance": [
        "All GitHub focused suites pass without real network or operator data access.",
        "The former g1-g80 loop is represented by a fast deterministic regression test.",
        "Tests prove zero PATCH for identical bodies and exactly one structured side effect per command version."
      ],
      "validation": [
        "npm run test:github-automation",
        "npm run test:github-unattended",
        "npm run test:github-unattended-runner",
        "npm run test:github-publish-policy"
      ],
      "risks": [
        "Mocks that skip emitted self webhooks can falsely pass; the chain test must feed generated mutations back through ingestion.",
        "Global scheduler state must be reset between tests."
      ],
      "parallelizable": true,
      "member": "implementer",
      "priority": 4,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "DOC-05",
      "title": "Document webhook identity, command, and recovery contracts",
      "phase": "docs",
      "order": 4,
      "dependsOn": ["CMD-03"],
      "relation": "parallel",
      "parallelGroup": "coverage-docs",
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/library.md",
        "docs/integrations/README.md",
        "docs/integrations/github-app-automation-setup.md",
        "docs/operations/troubleshooting.md"
      ],
      "instructions": [
        "Document the event/action/source matrix, audit-only self events, exact comment/version contract, generation rules, stable markers, and remote-effect reconcile behavior.",
        "Document the approved owner command target and examples, public receipt/status states, per-job versus global pause, closed-Issue behavior, and non-owner/Bot silence.",
        "State explicitly that Issue/comment text cannot alter global paused, validation, branch, remote, policy, credentials, or publisher and is never injected as an agent command.",
        "Add a troubleshooting runbook for detecting generation storms and verifying the stop-bleed without deleting history."
      ],
      "acceptance": [
        "Setup guidance and runtime docs describe one consistent command protocol.",
        "API/library maps point to the new source boundaries without exposing bodies or secrets.",
        "Troubleshooting preserves global paused as user-controlled and does not recommend deleting durable audit."
      ],
      "validation": [
        "Search all GitHub automation docs for stale 'any issue_comment enqueues' or broad adoption language.",
        "Review docs against the approved HTML and source tests."
      ],
      "risks": [
        "Stale examples may tell users to mention the wrong identity.",
        "Documentation could accidentally imply that resume clears the global kill switch."
      ],
      "parallelizable": true,
      "member": "implementer",
      "priority": 4,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "CHECK-06",
      "title": "Run integrated paused-safe validation and checker review",
      "phase": "validation",
      "order": 5,
      "dependsOn": ["TEST-04", "DOC-05"],
      "relation": "barrier",
      "files": [],
      "instructions": [
        "Run all GitHub focused suites, project lint, and TypeScript type-check. Perform privacy/source scans from checks.md.",
        "While global paused remains unchanged, validate fixture/mock flows and inspect real incoming delivery audit for zero new jobs. Do not perform a live unpaused GitHub mutation smoke without a separate user decision.",
        "Checker must review ingress-zero-side-effects, generation policy, exact-comment TOCTOU handling, remote idempotency, UI copy conformance, no-injection, schema compatibility, and rollback."
      ],
      "acceptance": [
        "Focused tests, lint, and tsc pass or unrelated pre-existing failures are isolated with evidence.",
        "No App self event can create/wake/rebind a job in tests or paused-safe observation.",
        "The approved GitHub timeline content matches production builders.",
        "Global paused remains unchanged and historical deliveries/jobs are preserved."
      ],
      "validation": [
        "npm run test:github-automation",
        "npm run test:github-unattended",
        "npm run test:github-unattended-runner",
        "npm run test:github-publish-policy",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Complete checks.md manual and privacy checklist"
      ],
      "risks": [
        "A real end-to-end command test is blocked while global paused remains enabled; report this rather than silently unpausing.",
        "Full-repo checks can reveal unrelated failures; do not misattribute them."
      ],
      "parallelizable": false,
      "member": "checker",
      "priority": 5,
      "localReview": { "required": true, "reviewer": "checker" }
    }
  ],
  "execution": {
    "mode": "mixed",
    "maxParallel": 2,
    "groups": [
      {
        "id": "ui-gate",
        "title": "User-visible GitHub timeline approval",
        "relation": "serial",
        "subtaskIds": ["UI-00"]
      },
      {
        "id": "safety-core",
        "title": "Ingress and remote idempotency",
        "relation": "serial",
        "dependencies": ["ui-gate"],
        "subtaskIds": ["LOOP-01", "IDEMP-02", "CMD-03"]
      },
      {
        "id": "coverage-docs",
        "title": "Regression coverage and documentation",
        "relation": "parallel",
        "dependencies": ["safety-core"],
        "subtaskIds": ["TEST-04", "DOC-05"]
      },
      {
        "id": "closeout",
        "title": "Integrated validation",
        "relation": "barrier",
        "dependencies": ["coverage-docs"],
        "subtaskIds": ["CHECK-06"]
      }
    ]
  }
}
```

## 验证命令

```bash
npm run test:github-automation
npm run test:github-unattended
npm run test:github-unattended-runner
npm run test:github-publish-policy
npm run lint
node_modules/.bin/tsc --noEmit
```

不要直接运行 `next build`。不要在验证中自行解除 global paused。

## 检查门禁

- UI-00 未完成、用户未批准 HTML/命令语法前，LOOP-01 不得开始。
- LOOP-01 必须先证明入口 self event 零 job/零 wake，才能开发 receipt/status。
- CMD-03 完成后 TEST-04 与 DOC-05 可并行，最大并发 2。
- CHECK-06 由 checker 执行；任何 self-loop、no-op PATCH、exact-comment、global paused、no-injection 失败均阻塞完成。
- 计划需由主会话通过 Studio 工具保存；当前 architect 不直接编辑 `task.json` 状态。

## 回滚

- self/Bot audit-only filter、action matrix、generation gate保留为安全修复。
- command UX 可通过关闭 command dispatch 回退到 Settings controls和现有 awaiting-owner adoption。
- receipt/status 停更但不删除历史评论。
- 不删除 g1–g80、delivery/event/job、WorkTree、Studio task；global paused 仍只由用户管理。
