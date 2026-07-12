# Implement - 改进任务派发与成员运行归属

## 先读

1. `docs/standards/code-style.md`
2. `docs/modules/library.md` 的 YPI Studio task/extension 约束
3. `lib/ypi-studio-types.ts`
4. `lib/ypi-studio-tasks.ts`：`claimYpiStudioImplementationSubtask`、`recordYpiStudioSubagentRun`、`getNextYpiStudioImplementationSubtask`
5. `lib/ypi-studio-extension.ts`：task tool、subagent start/cancel/persist paths、`buildMemberPrompt`
6. `app/api/studio/tasks/[taskKey]/route.ts` 与 `scripts/test-ypi-studio-dag.mjs`

## 执行步骤

1. 先扩展 types 和 body guard，保证新 action、`improvementId`、run 归属在编译期可追踪。
2. 在 task library 实现实例 scoped next/claim/run persistence，并用锁内 mutation 保护 instance plan/progress/runIds。
3. 接入 extension tool：参数 schema、tool action、subagent start 校验、prompt 与所有 lifecycle snapshot 透传。
4. 接入 PATCH route 的新 claim body。
5. 在 DAG script 覆盖正向和拒绝契约，运行 lint/typecheck 后交检查员复检。

## Implementation Plan

| ID | Phase | 工作项 | Depends On |
| --- | --- | --- | --- |
| `imp-scope-types` | contracts | 增加实例 claim body 与 run `improvementId` 契约 | - |
| `imp-scope-library` | library | 实现实例 next/claim/run 持久化与隔离状态机 | `imp-scope-types` |
| `imp-scope-tool-api` | integration | 接入 extension/tool/subagent 与 PATCH route | `imp-scope-library` |
| `imp-scope-tests` | verification | 增加 DAG 契约测试和全量静态验证 | `imp-scope-tool-api` |

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "summary": "Close improvement-instance execution dispatch and durable member-run attribution without changing the main-task DAG path.",
  "strategy": "ready_fifo",
  "maxConcurrency": 1,
  "scheduler": { "mode": "dag", "strategy": "ready_fifo", "failFast": true, "defaultFailurePolicy": "block_dependents" },
  "subtasks": [
    {
      "id": "imp-scope-types",
      "title": "Define explicit improvement claim and run scope contracts",
      "phase": "contracts",
      "order": 10,
      "dependsOn": [],
      "files": ["lib/ypi-studio-types.ts"],
      "instructions": ["Add YpiStudioImprovementSubtaskClaimBody with action claim_improvement_subtask and required improvementId.", "Add optional improvementId to YpiStudioTaskSubagentRun and preserve existing main-task payload compatibility.", "Keep the existing main-task claim body/action unchanged."],
      "acceptance": ["Type system can represent a scoped claim and a scoped run.", "Existing callers without improvementId remain valid."],
      "validation": ["node_modules/.bin/tsc --noEmit"],
      "risks": ["Making improvementId implicit in the main claim body would permit scope confusion."],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "imp-scope-library",
      "title": "Implement instance-local ready, claim, and run persistence",
      "phase": "library",
      "order": 20,
      "dependsOn": ["imp-scope-types"],
      "files": ["lib/ypi-studio-tasks.ts"],
      "instructions": ["Add locked instance resolver and executable-state guards.", "Extend implementation_next with explicit improvementId scope and add claimYpiStudioImprovementSubtask without mutating the root plan/progress.", "Update recordYpiStudioSubagentRun to append/dedupe instance.runIds and apply run state only to the scoped instance progress.", "Retain the existing no-improvementId branch unchanged."],
      "acceptance": ["Main plan subtask ids are rejected for an improvement scope.", "Each persisted scoped run is in exactly its instance runIds once.", "Completion, cancellation, and runtime-lost status update the same instance scope."],
      "validation": ["npm run test:studio-dag", "node_modules/.bin/tsc --noEmit"],
      "risks": ["Duplicated DAG mutation code can drift; extract a narrowly typed shared internal helper only if it preserves clear scope checks."],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "imp-scope-tool-api",
      "title": "Expose scoped dispatch through Studio tools and PATCH",
      "phase": "integration",
      "order": 30,
      "dependsOn": ["imp-scope-library"],
      "files": ["lib/ypi-studio-extension.ts", "app/api/studio/tasks/[taskKey]/route.ts"],
      "instructions": ["Add claim_improvement_subtask and improvementId to task tool normalizer/schema and route guard/branch.", "Pass improvementId into implementation_next and show scoped results.", "Add improvementId to subagent input/meta/run projections; validate instance scope before start, auto-claim only through instance helper, and build prompt from instance plan/progress.", "Ensure finalizer, cancel, SDK fallback, and runtime-lost paths preserve the stored improvementId via the persisted run."],
      "acceptance": ["Implementer/checker can start only an instance-owned claimed subtask while parent waits for improvements.", "A start with parent waiting plus a main-plan-only subtaskId fails before child launch.", "PATCH uses authorizedCwd and library validation."],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["One lifecycle snapshot that omits improvementId would make terminal persistence fall back to the wrong scope."],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "imp-scope-tests",
      "title": "Prove isolation and durable run attribution",
      "phase": "verification",
      "order": 40,
      "dependsOn": ["imp-scope-tool-api"],
      "files": ["scripts/test-ypi-studio-dag.mjs", "docs/modules/library.md", "docs/modules/api.md"],
      "instructions": ["Add positive and negative instance claim/next tests plus run start/final/cancel dedupe tests.", "Update module docs for the new PATCH/tool contract and explicit scope rule.", "Run required automated checks and record results in handoff."],
      "acceptance": ["Tests prove main and instance progress remain isolated.", "Tests prove instance.runIds survives all lifecycle writes without duplicates.", "Docs match the shipped API/tool action names."],
      "validation": ["npm run test:studio-dag", "npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["The existing script is library-level; manual tool/API smoke coverage remains necessary for extension schema wiring."],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    }
  ]
}
```

## Validation and rollback

Run `npm run test:studio-dag`, `npm run lint`, and `node_modules/.bin/tsc --noEmit`. Manually invoke the tool/API with one main plan and one improvement plan using overlapping subtask ids to verify scope rejection.

Rollback disables the new action and extension scope branch only. Do not remove `improvementId` or `instance.runIds` persisted history.
