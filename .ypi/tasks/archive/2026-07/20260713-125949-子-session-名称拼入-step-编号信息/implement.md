# Implement

## 建议执行顺序

1. **UI 原型门禁**：主会话派发 `ui-designer`，产出并取得用户对 HTML 原型的明确批准。
2. **共享标题与投影**：实现纯 helper、显示投影字段和 cache identity 修复；让 sidebar 与 SDK `session_info` 复用规则。
3. **测试与文档**：补 focused tests、模块文档，执行 lint/tsc 和手工侧栏验收。
4. **checker 门禁**：重点检查存量兼容、同 task 多 child 缓存隔离、截断优先级。

## 需先阅读

- `AGENTS.md`
- `docs/architecture/overview.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `docs/standards/code-style.md`
- `lib/session-title.ts`
- `lib/types.ts`
- `lib/session-reader.ts`
- `lib/ypi-studio-child-session-runner.ts`
- `components/SessionSidebar.tsx`
- `app/api/sessions/[id]/route.ts`
- `scripts/test-ypi-studio-sdk-runner.mjs`
- `.ypi/tasks/20260713-125949-子-session-名称拼入-step-编号信息/ui.md`

## 人类可读子任务表

| id | phase | order | title | dependsOn | parallelizable |
| --- | --- | ---: | --- | --- | --- |
| UI-STEP-TITLE | ui | 10 | HTML 原型与用户审批 | - | false |
| TITLE-PROJECTION | implement | 20 | 统一 step 标题、投影与 session_info | UI-STEP-TITLE | false |
| TITLE-CHECKS | checks | 30 | 测试、文档与行为验证 | TITLE-PROJECTION | false |

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "summary": "Use stable Studio subtask ids in child session titles, share one formatter between UI and persisted session_info, and preserve legacy sessions through read-time projection.",
  "maxConcurrency": 1,
  "subtasks": [
    {
      "id": "UI-STEP-TITLE",
      "title": "Produce and approve the child-session step-title HTML prototype",
      "phase": "ui",
      "order": 10,
      "dependsOn": [],
      "files": [
        ".ypi/tasks/20260713-125949-子-session-名称拼入-step-编号信息/ui.md",
        ".ypi/tasks/20260713-125949-子-session-名称拼入-step-编号信息/session-step-title-prototype.html",
        ".ypi/tasks/20260713-125949-子-session-名称拼入-step-编号信息/plan-review.md"
      ],
      "instructions": "Dispatch ui-designer. Base the self-contained HTML prototype on the existing SessionSidebar and the archived child-title prototype. Cover subtask id + title, multiple distinct steps, no-subtask member + task title, long values, narrow width, badge/detail/tooltip information allocation, and unchanged row interaction. Record explicit user approval before implementation.",
      "acceptance": "ui.md links to a meaningful HTML prototype and records explicit user approval. Pure Markdown does not satisfy the gate.",
      "validation": [
        "Open the HTML prototype in a browser and compare it with the current SessionSidebar visual language",
        "Confirm the approved copy uses subtask.id rather than a 1-based index"
      ],
      "risks": [
        "Implementation must not start before prototype and approval evidence exist"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "TITLE-PROJECTION",
      "title": "Unify Studio child step titles and projection identity",
      "phase": "implement",
      "order": 20,
      "dependsOn": ["UI-STEP-TITLE"],
      "files": [
        "lib/session-title.ts",
        "lib/types.ts",
        "lib/session-reader.ts",
        "lib/ypi-studio-child-session-runner.ts",
        "components/SessionSidebar.tsx"
      ],
      "instructions": "Add a pure Studio child title formatter with a 50-character budget and subtask-id-first allocation. Use subtask.id, never plan index. Add optional subtaskId to StudioChildSessionDisplay, populate it from the header, and include subtaskId/runId in the display cache key. Route displayTitleForSession and SDK studioChildSessionInfoName through the shared formatter. Do not migrate JSONL or change the studioChild header schema. Preserve run id/member/status in existing detail and tooltip paths.",
      "acceptance": "Bound implementer/checker child titles show '<subtaskId> · <subtaskTitle>'; title-missing children show the id; no-subtask children show member + task title without a fake number; sidebar and new session_info use the shared rule; old sessions update through projection only; two children under one task do not share the wrong projected title/summary.",
      "validation": [
        "npm run test:session-title",
        "npm run test:studio-sdk-runner",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "A cache key that omits runId can still cross-contaminate runSummary",
        "Naive truncation can preserve member while hiding the stable step id",
        "Duplicated formatting in runner and session-title will drift again"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "TITLE-CHECKS",
      "title": "Add focused tests, update docs, and validate sidebar behavior",
      "phase": "checks",
      "order": 30,
      "dependsOn": ["TITLE-PROJECTION"],
      "files": [
        "scripts/test-session-title.mjs",
        "scripts/test-ypi-studio-sdk-runner.mjs",
        "package.json",
        "docs/modules/library.md",
        "docs/modules/frontend.md",
        "docs/architecture/overview.md",
        ".ypi/tasks/20260713-125949-子-session-名称拼入-step-编号信息/checks.md"
      ],
      "instructions": "Add or extend focused tests for subtask id/title, id-only, no-subtask fallback, whitespace, 50-character priority, ordinary-session regression, and projection/cache isolation. Update module/architecture docs to describe canonical titles and no JSONL migration. Manually verify new and historical child rows at narrow width. Report any inability to run a real SDK child as an explicit validation gap.",
      "acceptance": "Focused tests and minimum lint/typecheck pass; docs match behavior; manual evidence covers subtask, no-subtask, historical, and narrow-sidebar cases; remaining gaps are explicit.",
      "validation": [
        "npm run test:session-title",
        "npm run test:studio-sdk-runner",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Manual browser verification with at least two distinct subtask children and one no-subtask child"
      ],
      "risks": [
        "Pure helper tests alone do not prove the runtime projection path",
        "A real child-run check may require configured model credentials"
      ],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "groups": [
      {
        "id": "step-title-delivery",
        "title": "Prototype, implementation, and verification",
        "relation": "serial",
        "subtaskIds": ["UI-STEP-TITLE", "TITLE-PROJECTION", "TITLE-CHECKS"],
        "dependencies": []
      }
    ]
  }
}
```

## 验证命令

```bash
npm run test:session-title
npm run test:studio-sdk-runner
npm run lint
node_modules/.bin/tsc --noEmit
```

## 评审门禁

- HTML 原型与用户审批必须先完成。
- implementationPlan 必须由主会话通过 Studio task action 保存，不能由 child 直接编辑 `task.json`。
- implementer 只能处理已批准的 `TITLE-PROJECTION`。
- checker 不得把“历史 JSONL 未回写”判为缺陷；应检查读时投影是否生效。
- 若用户改变 step 编号口径，返回 planning 修订 PRD/Design/plan revision，不在实现中临时改口径。

## 回滚

回退 helper、投影字段、cache key 和 runner caller。无需迁移回滚；已写的 canonical `session_info` 仍是有效会话名称。
