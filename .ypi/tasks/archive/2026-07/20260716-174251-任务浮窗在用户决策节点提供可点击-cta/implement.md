# Implement：YPI Studio 浮窗用户决策 CTA（Phase 1）

## 实施前门禁

1. 主会话真实派发 `ui-designer`，取得 `studio-widget-decision-cta-prototype.html`。
2. UI 设计员更新 [ui.md](ui.md) 与 [plan-review.md](plan-review.md)，用户明确批准 HTML 原型和本计划。
3. 主会话保存本 schemaVersion 2 plan，合法进入 `implementing` 后才可 claim/dispatch；不得提前派 implementer。

## 需先阅读

- `AGENTS.md`
- `docs/architecture/overview.md`
- `docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`
- `docs/standards/code-style.md`
- `lib/ypi-studio-types.ts`
- `lib/ypi-studio-tasks.ts`（approval helpers、transition、improvement approval、binding lock）
- `lib/ypi-studio-session-link.ts`
- `lib/ypi-studio-extension.ts`（input grant 与 state injection）
- `app/api/studio/tasks/[taskKey]/route.ts`
- `app/api/sessions/[id]/studio-task/route.ts`
- `lib/rpc-manager.ts`（Studio autocontinue/follow-up）
- `components/YpiStudioSessionWidget.tsx`
- `components/AppPromptProvider.tsx` / `AppPromptDialog.tsx`
- `scripts/test-ypi-studio-dag.mjs`、`scripts/test-ypi-studio-session-ownership.mjs`、`scripts/test-ypi-studio-main-accept.mjs`
- 本任务 [PRD](prd.md)、[Design](design.md)、[Checks](checks.md) 与用户批准后的 HTML 原型

## 人类可读子任务表

| 顺序 | ID | 子任务 | 依赖 | 并行 |
| ---: | --- | --- | --- | --- |
| 1 | CTA-DOMAIN-01 | 新增 action/grant 类型与原子 domain helpers | 用户批准 | 否 |
| 2 | CTA-PROJECTION-02 | 投影 `userActions[]` 并接入显式 PATCH action | 01 | 可与 03 并行 |
| 2 | CTA-CONTINUATION-03 | 主/改进/退回设计的安全续推与去重 | 01 | 可与 02 并行 |
| 3 | CTA-WIDGET-04 | 按批准原型实现桌面/移动决策区 | 02,03 | 否 |
| 4 | CTA-VERIFY-05 | 契约测试、回归、模块文档与人工验收 | 04 | 否 |

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "updatedAt": "2026-07-16T10:00:00.000Z",
  "sourceArtifact": "implement.md",
  "summary": "Add server-projected, context/revision-bound Phase 1 decision CTAs to the YPI Studio session widget without changing read-only previews.",
  "strategy": "Implement atomic domain actions first, parallelize projection/API and continuation wiring, then land the approved widget UI and verification barrier.",
  "maxConcurrency": 2,
  "scheduler": {
    "mode": "dag",
    "strategy": "ready_fifo",
    "failFast": false,
    "defaultFailurePolicy": "block_dependents"
  },
  "execution": {
    "mode": "mixed",
    "maxParallel": 2,
    "groups": [
      {
        "id": "domain",
        "title": "Atomic action foundation",
        "relation": "serial",
        "dependencies": [],
        "subtaskIds": ["CTA-DOMAIN-01"]
      },
      {
        "id": "server-parallel",
        "title": "Projection/API and continuation",
        "relation": "parallel",
        "dependencies": ["CTA-DOMAIN-01"],
        "subtaskIds": ["CTA-PROJECTION-02", "CTA-CONTINUATION-03"]
      },
      {
        "id": "widget",
        "title": "Approved widget UI",
        "relation": "barrier",
        "dependencies": ["CTA-PROJECTION-02", "CTA-CONTINUATION-03"],
        "subtaskIds": ["CTA-WIDGET-04"]
      },
      {
        "id": "verify",
        "title": "Verification and documentation",
        "relation": "barrier",
        "dependencies": ["CTA-WIDGET-04"],
        "subtaskIds": ["CTA-VERIFY-05"]
      }
    ]
  },
  "subtasks": [
    {
      "id": "CTA-DOMAIN-01",
      "title": "Add widget action contracts and atomic approval/change helpers",
      "phase": "backend-foundation",
      "description": "Extend grant source compatibility and implement lock-protected main/improvement widget actions with revision CAS.",
      "order": 10,
      "dependsOn": [],
      "relation": "serial",
      "files": [
        "lib/ypi-studio-types.ts",
        "lib/ypi-studio-tasks.ts",
        "lib/ypi-studio-extension.ts",
        "scripts/test-ypi-studio-dag.mjs",
        "scripts/test-ypi-studio-session-ownership.mjs"
      ],
      "instructions": [
        "Add fixed user action types and user-widget grant source while retaining historical user-input reads.",
        "Implement approve_plan, request_plan_changes, and approve_improvement_plan as single-lock atomic helpers; do not compose public lock-taking helpers.",
        "Require active task, exact bound context, expected revision, expected state, and existing material/UI gates.",
        "Keep override absent from these contracts and preserve preview read-only behavior."
      ],
      "acceptance": [
        "A successful main approval writes one auditable user-widget grant and enters implementing atomically.",
        "Request changes requires bounded non-empty feedback, returns to planning, clears grant, and increments revision.",
        "Improvement approval affects only the requested instance and leaves the parent in waiting_for_improvements.",
        "Every rejected precondition produces zero partial writes."
      ],
      "validation": [
        "npm run test:studio-dag",
        "npm run test:studio-session-ownership",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Nested task locks can cause partial or failed writes if existing public helpers are called directly.",
        "Changing grant source readers inconsistently can invalidate legal grants."
      ],
      "parallelizable": false,
      "member": "implementer",
      "failurePolicy": "block_dependents",
      "retry": { "maxAttempts": 1 },
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "CTA-PROJECTION-02",
      "title": "Project bounded user actions and expose explicit task PATCH actions",
      "phase": "server-integration",
      "description": "Build sparse action descriptors from authoritative task detail and route fixed action bodies to domain helpers.",
      "order": 20,
      "dependsOn": ["CTA-DOMAIN-01"],
      "relation": "parallel",
      "parallelGroup": "server-parallel",
      "files": [
        "lib/ypi-studio-session-link.ts",
        "lib/ypi-studio-types.ts",
        "app/api/studio/tasks/[taskKey]/route.ts",
        "scripts/test-ypi-studio-widget-actions.mjs"
      ],
      "instructions": [
        "Emit at most two allowlisted action descriptors and never emit endpoint/body/artifact/feedback/path fields.",
        "Main awaiting approval emits primary approve plus secondary request changes; improvement flow emits only the first waiting-plan approval action.",
        "Match explicit action bodies before loose transition bodies and map validation/conflict/material errors safely.",
        "Keep action visibility advisory and revalidate all conditions on write."
      ],
      "acceptance": [
        "Normal phases and archived tasks project no decision CTA.",
        "Stale revision and stale state requests return a conflict and never mutate the task.",
        "Old clients can ignore the additive field without behavior changes."
      ],
      "validation": [
        "node --loader ./scripts/ts-extension-loader.mjs scripts/test-ypi-studio-widget-actions.mjs",
        "npm run test:studio-main-accept",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Frontend status inference could accidentally reappear if descriptors are incomplete.",
        "The route's loose transition body matcher can swallow explicit action bodies if ordering is wrong."
      ],
      "parallelizable": true,
      "member": "implementer",
      "failurePolicy": "block_dependents",
      "retry": { "maxAttempts": 1 },
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "CTA-CONTINUATION-03",
      "title": "Continue main and improvement orchestration safely after UI decisions",
      "phase": "runtime-integration",
      "description": "Reuse Studio follow-up infrastructure while preserving primary-task and improvement DAG scoping.",
      "order": 30,
      "dependsOn": ["CTA-DOMAIN-01"],
      "relation": "parallel",
      "parallelGroup": "server-parallel",
      "files": [
        "app/api/sessions/[id]/studio-task/route.ts",
        "lib/rpc-manager.ts",
        "lib/ypi-studio-session-link.ts",
        "scripts/test-ypi-studio-dag.mjs"
      ],
      "instructions": [
        "Preserve existing primary main-task implementing autocontinue.",
        "Add improvement-scoped continuation with improvementId in the dedupe key and fixed follow-up prompt.",
        "For request changes, best-effort continue the bound session to re-run architecture planning using already persisted bounded feedback.",
        "Never roll back a legal persisted decision because the live wrapper is missing or continuation delivery fails."
      ],
      "acceptance": [
        "Main approvals fill only main DAG free slots.",
        "Improvement approvals call only improvement_next/claim_improvement_subtask for the exact instance.",
        "Continuation is idempotent and failure remains recoverable from the bound chat."
      ],
      "validation": [
        "npm run test:studio-dag",
        "npm run test:studio-session-ownership",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "A generic continuation prompt could claim the main DAG during an improvement flow.",
        "Repeated polling can enqueue duplicate model turns without a scope-aware state key."
      ],
      "parallelizable": true,
      "member": "implementer",
      "failurePolicy": "block_dependents",
      "retry": { "maxAttempts": 1 },
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "CTA-WIDGET-04",
      "title": "Render the approved desktop/mobile decision experience",
      "phase": "frontend",
      "description": "Implement the user decision region from server actions using existing AppPrompt and widget write guards.",
      "order": 40,
      "dependsOn": ["CTA-PROJECTION-02", "CTA-CONTINUATION-03"],
      "relation": "barrier",
      "files": [
        "components/YpiStudioSessionWidget.tsx",
        "app/globals.css",
        "components/AppPromptProvider.tsx"
      ],
      "instructions": [
        "Follow the user-approved HTML prototype; do not implement from this planning text alone when visual details differ.",
        "ADDITIVE ONLY: do not remove or replace WorkflowRail, quickPreviews, improvement summary, improvement result accept list, main-task accept/archive, archived badge, sessionRuntime, compact subtasks, or live runs.",
        "Render only task.userActions for the NEW decision region and map fixed action kinds to local confirmation/input templates.",
        "Keep card order: shell/rail/meta -> improvement summary+result accept -> main accept -> archived badge -> read-only previews -> NEW decision region -> runtime/implementation.",
        "Reuse a shared in-flight guard across new decisions and existing acceptance writes; refresh on success and failure; keep handleAcceptImprovement/handleAcceptMainTask behavior.",
        "Cover mobile sheet, focus restoration, drag event isolation, aria-busy, safe errors, and reduced motion."
      ],
      "acceptance": [
        "Main and improvement PLAN confirmations identify target and revision without confusing plan approval with result acceptance.",
        "Existing improvement result accept and main-task accept/archive still render and work when their gates are true.",
        "Request changes cannot submit blank feedback.",
        "No planning/implementing/checking pseudo-continue button appears.",
        "Desktop and mobile match the approved prototype and remain keyboard accessible; conservation checklist A-F passes."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Manual browser verification against studio-widget-decision-cta-prototype.html"
      ],
      "risks": [
        "Dense card content can push runtime state below the fold.",
        "Inline event handling can interfere with draggable shells."
      ],
      "parallelizable": false,
      "member": "implementer",
      "failurePolicy": "block_dependents",
      "retry": { "maxAttempts": 1 },
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "CTA-VERIFY-05",
      "title": "Verify action security, regressions, UI states, and module documentation",
      "phase": "verification",
      "description": "Add focused regression coverage, run the project validation set, and document the delivered contracts.",
      "order": 50,
      "dependsOn": ["CTA-WIDGET-04"],
      "relation": "barrier",
      "files": [
        "scripts/test-ypi-studio-widget-actions.mjs",
        "scripts/test-ypi-studio-dag.mjs",
        "scripts/test-ypi-studio-session-ownership.mjs",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/architecture/overview.md",
        "package.json"
      ],
      "instructions": [
        "Test happy paths, stale state/revision, wrong context, transfer, missing material, duplicate click, and improvement scope.",
        "Confirm preview/modal remain read-only and existing acceptance flows still pass (studio-main-accept + studio-task-preview must stay green).",
        "Diff-review YpiStudioSessionWidget against conservation checklist: no accidental deletion of accept/preview/rail/runtime blocks.",
        "Document userActions wire fields, explicit PATCH actions, grant sources, continuation scope, compatibility, rollback, and conservation invariants.",
        "Run the approved HTML/manual accessibility matrix including result-acceptance scenes and record unrelated failures rather than changing unrelated code."
      ],
      "acceptance": [
        "Focused tests prove zero partial writes and no override bypass.",
        "Existing main/improvement acceptance and read-only preview regressions pass.",
        "Module docs match the final wire/on-disk behavior and list conservation invariants.",
        "Lint, typecheck, Studio regressions, and manual UI checks pass or have clearly isolated blockers."
      ],
      "validation": [
        "npm run test:studio-widget-actions",
        "npm run test:studio-dag",
        "npm run test:studio-main-accept",
        "npm run test:studio-task-preview",
        "npm run test:studio-session-ownership",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "No full browser automation currently covers draggable widget and AppPrompt focus together.",
        "Documentation can drift if action/error names change during implementation."
      ],
      "parallelizable": false,
      "member": "checker",
      "failurePolicy": "manual",
      "retry": { "maxAttempts": 1 },
      "localReview": { "required": true, "reviewer": "checker" }
    }
  ]
}
```

## 执行门禁

- 01 完成并经本地检查后，主会话同一轮可 claim 02 与 03，分别派发一个绑定 subtaskId 的 async implementer；随后使用 `ypi_studio_wait`。
- 04 必须等待 02/03 均完成，并严格按用户批准的 HTML 实现。
- 05 是 barrier，由 checker 执行；不得让实现员自报代替检查员。

## 验证命令

```bash
npm run test:studio-widget-actions
npm run test:studio-dag
npm run test:studio-main-accept
npm run test:studio-task-preview
npm run test:studio-session-ownership
npm run lint
node_modules/.bin/tsc --noEmit
```

## 回滚

1. 首先停止 `userActions` 投影，立即隐藏新 CTA，不影响旧聊天审批。
2. 回滚 widget decision region 与 continuation 分支；保留合法 `user-widget` grant 的读取兼容。
3. 不回写历史 task.json/events，不删除已记录用户决定。
4. 若仅续推异常，关闭新续推而保留 action/domain；用户可从绑定聊天恢复编排。
