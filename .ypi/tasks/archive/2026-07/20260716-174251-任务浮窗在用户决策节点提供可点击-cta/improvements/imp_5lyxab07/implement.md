# Implement：IMP-002 start_user_acceptance

## 实施前门禁

1. 用户批准 [plan-review.md](plan-review.md) 与最小 UI 证据（[ui.md](ui.md) / [HTML 原型](studio-widget-start-user-acceptance-prototype.html)）。  
2. 主会话将改进实例迁入 `implementing` 并登记本 schemaVersion 2 plan 后再 claim；**本文件仅为计划，不表示已实现**。  
3. 不得在 `waiting_plan_approval` 前改生产代码。

## 需先阅读

- 父任务 Phase 1：`design.md` / `implement.md` / 保全清单  
- `lib/ypi-studio-workflows.ts`（`review → user_acceptance`）  
- `lib/ypi-studio-session-link.ts`（`buildWidgetUserActions`, `canAcceptMainTask`）  
- `lib/ypi-studio-tasks.ts`（Phase 1 widget helpers + transition）  
- `app/api/studio/tasks/[taskKey]/route.ts`  
- `components/YpiStudioSessionWidget.tsx`（decision region + main accept）  
- `scripts/test-ypi-studio-widget-actions.mjs` / `test-ypi-studio-main-accept.mjs`  
- 本改进 [prd.md](prd.md) [design.md](design.md) [checks.md](checks.md)

## 人类可读子任务

| 顺序 | ID | 内容 | 依赖 | 并行 |
| ---: | --- | --- | --- | --- |
| 1 | SUA-DOMAIN-01 | 类型 + 原子 helper + body guard | 批准 | 否 |
| 2 | SUA-PROJECTION-02 | 投影 + PATCH 路由 | 01 | 可与 03 并行 |
| 2 | SUA-WIDGET-03 | 决策区 kind 映射 + 确认模板 | 01 | 可与 02 并行（类型已合入后） |
| 3 | SUA-VERIFY-04 | 测试 / 文档 / 保全回归 | 02,03 | 否 |

> 极小改动：主会话也可串行单 implementer 一次做完 01–03，再 checker 04。`maxConcurrency=2` 仅在分派两人时使用。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "updatedAt": "2026-07-17T01:20:00.000Z",
  "sourceArtifact": "implement.md",
  "summary": "Add a server-projected review→user_acceptance widget CTA without relaxing main-result acceptance gates or Phase 1 decision CTAs.",
  "strategy": "Atomic domain helper first; projection/route and widget kind wiring in parallel; verification barrier last.",
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
        "title": "Atomic start_user_acceptance helper",
        "relation": "serial",
        "dependencies": [],
        "subtaskIds": ["SUA-DOMAIN-01"]
      },
      {
        "id": "wire",
        "title": "Projection/API and widget",
        "relation": "parallel",
        "dependencies": ["SUA-DOMAIN-01"],
        "subtaskIds": ["SUA-PROJECTION-02", "SUA-WIDGET-03"]
      },
      {
        "id": "verify",
        "title": "Verification",
        "relation": "barrier",
        "dependencies": ["SUA-PROJECTION-02", "SUA-WIDGET-03"],
        "subtaskIds": ["SUA-VERIFY-04"]
      }
    ]
  },
  "subtasks": [
    {
      "id": "SUA-DOMAIN-01",
      "title": "Add start_user_acceptance types and single-lock helper",
      "phase": "backend-foundation",
      "description": "Extend action kind and implement review→user_acceptance widget helper with binding/status/unresolved/revision checks.",
      "order": 10,
      "dependsOn": [],
      "relation": "serial",
      "files": [
        "lib/ypi-studio-types.ts",
        "lib/ypi-studio-tasks.ts",
        "scripts/test-ypi-studio-dag.mjs"
      ],
      "instructions": [
        "Add YpiStudioWidgetUserActionKind start_user_acceptance and body type/guard (reject override).",
        "Implement startYpiStudioUserAcceptanceFromWidget without nested public lock helpers.",
        "Require active, bound session context, status review, unresolved==0, revision CAS; transition only to user_acceptance.",
        "Audit source user-widget; do not write plan approvalGrant; do not complete/archive."
      ],
      "acceptance": [
        "Happy path: review→user_acceptance in one write; event auditable.",
        "Wrong status/context/unresolved/stale revision: zero partial writes.",
        "canAcceptMain still false until status is user_acceptance (projection may be separate subtask)."
      ],
      "validation": [
        "npm run test:studio-dag",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Calling transitionYpiStudioTask nested causes lock issues."
      ],
      "parallelizable": false,
      "member": "implementer",
      "failurePolicy": "block_dependents",
      "retry": { "maxAttempts": 1 },
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "SUA-PROJECTION-02",
      "title": "Project start_user_acceptance and route explicit PATCH",
      "phase": "server-integration",
      "description": "Emit the CTA only for review+unresolved0; match action before loose transition.",
      "order": 20,
      "dependsOn": ["SUA-DOMAIN-01"],
      "relation": "parallel",
      "parallelGroup": "wire",
      "files": [
        "lib/ypi-studio-session-link.ts",
        "app/api/studio/tasks/[taskKey]/route.ts",
        "scripts/test-ypi-studio-widget-actions.mjs"
      ],
      "instructions": [
        "Extend buildWidgetUserActions for review with unresolved==0 only.",
        "Keep max 2 actions; this status emits exactly one primary.",
        "Route start_user_acceptance before loose transition; map conflicts safely.",
        "Do not change canAcceptMainTask truth table."
      ],
      "acceptance": [
        "review+clean projects one CTA; other phases unchanged for existing kinds.",
        "Stale/conflict returns 409 without mutation."
      ],
      "validation": [
        "npm run test:studio-widget-actions",
        "npm run test:studio-main-accept",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Forgetting unresolved filter could show CTA while improvements pending."
      ],
      "parallelizable": true,
      "member": "implementer",
      "failurePolicy": "block_dependents",
      "retry": { "maxAttempts": 1 },
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "SUA-WIDGET-03",
      "title": "Wire decision-region confirm UI for start_user_acceptance",
      "phase": "frontend",
      "description": "Allowlist the new kind and map confirm/busy copy without touching main-accept or Phase 1 plan CTAs.",
      "order": 30,
      "dependsOn": ["SUA-DOMAIN-01"],
      "relation": "parallel",
      "parallelGroup": "wire",
      "files": [
        "components/YpiStudioSessionWidget.tsx",
        "app/globals.css"
      ],
      "instructions": [
        "Follow approved minimal HTML/ui.md templates.",
        "ADDITIVE ONLY: keep full 8-station rail, previews, improvement accept, main accept/archive, Phase 1 kinds.",
        "Confirm distinguishes enter acceptance vs result accept; shared in-flight lock.",
        "After success, rely on refresh for canAcceptMain UI — no optimistic completed."
      ],
      "acceptance": [
        "review card shows primary CTA in decision region only.",
        "Main accept still only when user_acceptance.",
        "Conservation checklist A–F and Phase 1 CTAs pass."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Copy confusion with main-accept button if labels too similar."
      ],
      "parallelizable": true,
      "member": "implementer",
      "failurePolicy": "block_dependents",
      "retry": { "maxAttempts": 1 },
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "SUA-VERIFY-04",
      "title": "Tests, docs, conservation regression",
      "phase": "verification",
      "description": "Lock matrix and document the new kind.",
      "order": 40,
      "dependsOn": ["SUA-PROJECTION-02", "SUA-WIDGET-03"],
      "relation": "barrier",
      "files": [
        "scripts/test-ypi-studio-widget-actions.mjs",
        "scripts/test-ypi-studio-main-accept.mjs",
        "scripts/test-ypi-studio-dag.mjs",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md"
      ],
      "instructions": [
        "Add projection/write cases for start_user_acceptance; keep review canAcceptMain false.",
        "Regression: studio-main-accept, studio-task-preview, studio-widget-actions, studio-dag.",
        "Document action kind, projection rule, conservation note.",
        "Diff widget for accidental deletions of rail/preview/accept/Phase 1 handlers."
      ],
      "acceptance": [
        "All listed tests green; docs match wire behavior.",
        "No override bypass; no skip of user_acceptance result step."
      ],
      "validation": [
        "npm run test:studio-widget-actions",
        "npm run test:studio-main-accept",
        "npm run test:studio-dag",
        "npm run test:studio-task-preview",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Docs drift if error codes renamed."
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

- 01 完成并本地检查后，主会话可同轮 claim 02 与 03（`maxConcurrency=2`）。  
- 04 由 checker 执行；不得以实现员自报代替。  
- 批准前不得 claim。

## 验证命令

```bash
npm run test:studio-widget-actions
npm run test:studio-main-accept
npm run test:studio-dag
npm run test:studio-task-preview
npm run lint
node_modules/.bin/tsc --noEmit
```

## 回滚

1. 停止投影 `start_user_acceptance`。  
2. 可选撤回 route/helper；已进入 `user_acceptance` 的任务保留。  
3. 不改写历史 events。
