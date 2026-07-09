# implement

> 当前仅为审批用实现计划，不进入实现；也未写入任务的 implementationPlan 状态。用户确认 [`plan-review.md`](plan-review.md) 后再执行。

## 建议执行顺序

| Order | ID | 子任务 | 关键文件 | 可并行 |
| --- | --- | --- | --- | --- |
| 1 | PS-001 | 扩展 Project Registry space 排序字段与 helper | `lib/project-registry-types.ts`, `lib/project-registry.ts`, `lib/project-display.ts` | 否 |
| 2 | PS-002 | 增加项目级空间批量排序 API | `app/api/projects/[projectId]/spaces/route.ts`, `docs/modules/api.md` | 依赖 PS-001 |
| 3 | PS-003 | 重构 Sidebar context menu 动作承载 | `components/SessionSidebar.tsx` | 依赖 PS-001 |
| 4 | PS-004 | 升级 ProjectSpaceSwitchDialog 卡片右键与拖动排序 UI | `components/ProjectSpaceSwitchDialog.tsx` | 依赖 PS-002/PS-003 |
| 5 | PS-005 | 统一星标文案与元数据弹窗文案 | `components/SessionSidebar.tsx`, `components/ProjectSpaceSwitchDialog.tsx` | 可与 PS-004 合并 |
| 6 | PS-006 | 文档、回归验证与手工验收 | `docs/modules/frontend.md`, `docs/modules/library.md`, `docs/modules/api.md` | 依赖前序 |

## 需先阅读的文件

- [`brief.md`](brief.md)
- [`prd.md`](prd.md)
- [`design.md`](design.md)
- [`ui.md`](ui.md)
- [`project-switch-card-menu-prototype.html`](project-switch-card-menu-prototype.html)
- `components/SessionSidebar.tsx`
- `components/ProjectSpaceSwitchDialog.tsx`
- `lib/project-display.ts`
- `lib/project-registry-types.ts`
- `lib/project-registry.ts`
- `app/api/projects/[projectId]/spaces/route.ts`
- `docs/modules/frontend.md`, `docs/modules/library.md`, `docs/modules/api.md`

## 实现要点

1. **不要新增收藏字段**：星标继续写 `pinned`。
2. **必须新增持久化空间顺序字段**：推荐 `sortOrder?: number`，只作用于同 project 的非主空间。
3. **批量排序优先**：拖动保存通过 `PATCH /api/projects/[projectId]/spaces` 一次性保存顺序，避免多次 PATCH 造成部分成功。
4. **WorkTree 安全流程复用**：archive/delete 仍进入现有 `worktreeAction` 确认弹窗，不直接执行破坏性动作。
5. **Dialog 仍是 UI shell**：业务动作和 registry mutation 继续由 `SessionSidebar` 承载并回传。
6. **主空间不可拖动**：实现和 UI 都不能允许 `main` 进入 reorder payload。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "subtasks": [
    {
      "id": "PS-001",
      "title": "Add persistent space sort order model and display helpers",
      "phase": "data-model",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/project-registry-types.ts",
        "lib/project-registry.ts",
        "lib/project-display.ts"
      ],
      "instructions": [
        "Add optional sortOrder to PiWebProjectSpaceRecord and validation support for numeric sort order where needed.",
        "Update activeProjectSpaces so main is always first and non-main spaces use effective sortOrder; do not use pinned to sort spaces.",
        "Add helper logic for effective fallback order for legacy spaces without sortOrder.",
        "When creating a new worktree space, assign sortOrder after the current active non-main maximum; preserve sortOrder when reusing an existing space."
      ],
      "acceptance": [
        "Project sorting remains unchanged.",
        "Space sorting no longer moves starred spaces before non-starred spaces.",
        "New non-main spaces receive an order that places them at the bottom."
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Legacy spaces without sortOrder may reorder if fallback is not stable.",
        "New WorkTree discovery may accidentally reset existing order if upsert does not preserve fields."
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "PS-002",
      "title": "Add project-level batch API for reordering spaces",
      "phase": "api",
      "order": 2,
      "dependsOn": ["PS-001"],
      "files": [
        "app/api/projects/[projectId]/spaces/route.ts",
        "lib/project-registry.ts",
        "docs/modules/api.md"
      ],
      "instructions": [
        "Add PATCH /api/projects/[projectId]/spaces accepting orderedSpaceIds for active non-main spaces.",
        "Reject main, unknown, archived, duplicate, or cross-project ids.",
        "Append active non-main spaces missing from the payload after the provided ids while preserving their relative order.",
        "Return the updated project and spaces."
      ],
      "acceptance": [
        "A reorder request persists sortOrder for active non-main spaces.",
        "Invalid ids return an error without partial mutation.",
        "Concurrent newly discovered spaces are not dropped from the registry order."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Batch API may need careful atomic read/write behavior to avoid partial updates."
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "PS-003",
      "title": "Centralize project and space context menu actions in SessionSidebar",
      "phase": "frontend-state",
      "order": 3,
      "dependsOn": ["PS-001"],
      "files": [
        "components/SessionSidebar.tsx"
      ],
      "instructions": [
        "Introduce a unified project/space context menu state with target project and optional space.",
        "Wire menu actions to existing metadata dialog, project PATCH, space PATCH, and WorkTree confirmation handlers.",
        "Keep the top workspace menu but update labels from pinned/top to star/unstar and scope them to current workspace actions.",
        "Ensure destructive project/space archive actions keep existing confirmation behavior."
      ],
      "acceptance": [
        "Top menu remains available for the current workspace.",
        "Project and space context menus can target objects that are not currently selected.",
        "WorkTree delete/archive still opens the existing confirmation flow."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Menu click/outside-click behavior may conflict with the modal focus trap.",
        "Actions on non-selected targets may accidentally mutate selected state if callbacks are reused incorrectly."
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "PS-004",
      "title": "Implement dialog card context menus and non-main space drag sorting",
      "phase": "frontend-ui",
      "order": 4,
      "dependsOn": ["PS-002", "PS-003"],
      "files": [
        "components/ProjectSpaceSwitchDialog.tsx",
        "components/SessionSidebar.tsx"
      ],
      "instructions": [
        "Add onProjectContextMenu and onSpaceContextMenu props or equivalent callbacks from the dialog to SessionSidebar.",
        "Trigger project context menu on every project card and space context menu on every space row/card, including main and WorkTree rows.",
        "Add drag handle and drag/drop state for non-main spaces only.",
        "Call the batch reorder API after drop; rollback or refresh on failure.",
        "Render visual affordances matching the approved HTML prototype."
      ],
      "acceptance": [
        "Right-click works on project cards, main space rows, and WorkTree space rows.",
        "Main space stays first and cannot be dragged.",
        "Dragging non-main spaces updates order and persists after refresh.",
        "Missing spaces cannot be selected but still expose safe metadata/archive actions when applicable."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Manual browser check of right-click menus and drag/drop ordering"
      ],
      "risks": [
        "HTML5 drag/drop can be finicky in nested scroll containers.",
        "Keyboard/touch alternatives may remain limited in the first version."
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "PS-005",
      "title": "Normalize star terminology and visible status copy",
      "phase": "frontend-copy",
      "order": 5,
      "dependsOn": ["PS-003"],
      "files": [
        "components/SessionSidebar.tsx",
        "components/ProjectSpaceSwitchDialog.tsx"
      ],
      "instructions": [
        "Replace user-visible top/pinned wording with star/unstar wording for project and space actions.",
        "Keep internal pinned fields and existing API payloads unchanged.",
        "Make space star visual state clear without implying it controls ordering."
      ],
      "acceptance": [
        "User-visible action labels use 星标/取消星标.",
        "Metadata dialog no longer says the space star affects sidebar ordering unless the text is project-specific.",
        "Internal data still uses pinned."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Some old copy may remain in tooltips or aria labels."
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "PS-006",
      "title": "Update docs and run final validation",
      "phase": "docs-validation",
      "order": 6,
      "dependsOn": ["PS-001", "PS-002", "PS-003", "PS-004", "PS-005"],
      "files": [
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/modules/api.md"
      ],
      "instructions": [
        "Update module docs for ProjectSpaceSwitchDialog, SessionSidebar, project-display, project-registry, and the new reorder API.",
        "Run lint and TypeScript validation.",
        "Perform manual checks from checks.md."
      ],
      "acceptance": [
        "Docs describe the new menu responsibilities, star semantics, and space ordering contract.",
        "Automated validation passes or known blockers are documented.",
        "Manual acceptance checklist is completed before review."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Docs can drift if implementation names differ from the plan."
      ],
      "parallelizable": false,
      "localReview": true
    }
  ]
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## 检查门禁

- 用户已确认 [`plan-review.md`](plan-review.md) 与 HTML 原型。
- 实现前不得跳过 UI 原型审批。
- 代码完成后需执行自动验证，并按 [`checks.md`](checks.md) 做人工验收。
