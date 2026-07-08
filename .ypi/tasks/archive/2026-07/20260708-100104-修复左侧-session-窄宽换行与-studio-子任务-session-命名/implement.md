# Implement

## 执行步骤

1. 先完成 UI 门禁：指派 `ui-designer` 输出 HTML 原型并取得用户/主会话审批。
2. 修复 SessionSidebar 窄宽布局：普通行与归档行统一单行截断规则。
3. 修复 Studio child session 展示标题优先级：subtaskTitle -> member + taskTitle -> 安全 fallback。
4. 修复 SDK child session 新建时写入的 `session_info` 命名。
5. 更新相关模块文档（如实现改动改变行为描述）。
6. 运行验证并交给 checker 做 UI/行为回归。

## 需先阅读的文件

- `docs/architecture/overview.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `components/SessionSidebar.tsx`
- `lib/session-title.ts`
- `lib/session-reader.ts`
- `lib/ypi-studio-child-session-runner.ts`
- `lib/types.ts`
- `app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts`

## 人类可读子任务表

| id | phase | title | dependsOn | files |
| --- | --- | --- | --- | --- |
| ui-prototype-approval | ui | 产出并审批 HTML 原型 | - | `ui.md`, optional `ui-prototype.html` |
| sidebar-nowrap | frontend | 修复 SessionSidebar 窄宽单行截断 | ui-prototype-approval | `components/SessionSidebar.tsx` |
| studio-child-title-display | library | 调整 Studio child 展示标题优先级 | ui-prototype-approval | `lib/session-title.ts`, maybe `lib/session-reader.ts` |
| sdk-child-session-info-name | library | 调整 SDK child session_info 命名 | studio-child-title-display | `lib/ypi-studio-child-session-runner.ts` |
| docs-validation | checks | 文档与验证 | sidebar-nowrap, studio-child-title-display, sdk-child-session-info-name | `docs/modules/frontend.md`, `docs/modules/library.md`, validation commands |

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "summary": "Fix narrow sidebar Session row wrapping and make YPI Studio child session titles prefer implementation subtask names.",
  "subtasks": [
    {
      "id": "ui-prototype-approval",
      "title": "Produce and approve HTML UI prototype",
      "phase": "ui",
      "order": 1,
      "dependsOn": [],
      "files": [
        ".ypi/tasks/20260708-100104-修复左侧-session-窄宽换行与-studio-子任务-session-命名/ui.md",
        ".ypi/tasks/20260708-100104-修复左侧-session-窄宽换行与-studio-子任务-session-命名/ui-prototype.html"
      ],
      "instructions": "Have ui-designer create an HTML prototype for narrow Session rows, Studio child rows, hover actions, delete confirm, and archived rows. Record user/main-session approval before implementation.",
      "acceptance": "ui.md links to or embeds an HTML prototype and records approval. Pure Markdown is not enough.",
      "validation": [
        "Manual review of HTML prototype against existing SessionSidebar visuals"
      ],
      "risks": [
        "Implementation is blocked until approval exists"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "sidebar-nowrap",
      "title": "Make SessionSidebar rows narrow-width safe",
      "phase": "frontend",
      "order": 2,
      "dependsOn": ["ui-prototype-approval"],
      "files": ["components/SessionSidebar.tsx"],
      "instructions": "Apply consistent minWidth:0, overflow:hidden, whiteSpace:'nowrap', textOverflow:'ellipsis', flexWrap:'nowrap' rules to SessionItem and ArchivedSessionItem title rows and metadata rows. Ensure Studio detail is the shrinkable/ellipsized long metadata item while short chips/buttons remain stable.",
      "acceptance": "At very narrow sidebar width, normal/studio/archived rows keep fixed height and no text wraps into additional lines.",
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Manual browser resize/hover/delete-confirm check"
      ],
      "risks": [
        "Hover buttons may consume most row width; confirm text truncates instead of wrapping"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "studio-child-title-display",
      "title": "Prefer implementation subtask titles for Studio child display titles",
      "phase": "library",
      "order": 3,
      "dependsOn": ["ui-prototype-approval"],
      "files": ["lib/session-title.ts", "lib/session-reader.ts"],
      "instructions": "Change Studio child branch of displayTitleForSession so subtaskTitle is first priority, then member + taskTitle, then run/task fallbacks. Reuse existing studioChildDisplay projection; do not add API fields unless necessary.",
      "acceptance": "A child session with studioChildDisplay.subtaskTitle displays that subtask title; without it but with taskTitle displays member + taskTitle.",
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Manual or small local sample check for displayTitleForSession"
      ],
      "risks": [
        "Member ids are currently English; confirm if Chinese role labels are required"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "sdk-child-session-info-name",
      "title": "Fix SDK child session_info naming",
      "phase": "library",
      "order": 4,
      "dependsOn": ["studio-child-title-display"],
      "files": ["lib/ypi-studio-child-session-runner.ts"],
      "instructions": "Update studioChildSessionInfoName to resolve meta.subtaskId against implementationProjection/implementationPlan and use subtask title first. If no subtask title, format as YPI Studio <member> · <taskTitle> · <runShortId>. Keep catch/fallback safe.",
      "acceptance": "New SDK child sessions no longer write a session_info name that is only the main task title when a subtask was assigned.",
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Optionally run or inspect a new ypi_studio_subagent SDK child session"
      ],
      "risks": [
        "Only future sessions get corrected session_info; historical display is handled separately"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "docs-validation",
      "title": "Update docs and run final validation",
      "phase": "checks",
      "order": 5,
      "dependsOn": ["sidebar-nowrap", "studio-child-title-display", "sdk-child-session-info-name"],
      "files": ["docs/modules/frontend.md", "docs/modules/library.md"],
      "instructions": "Update module docs if behavior descriptions need adjustment. Run lint and TypeScript checks. Record manual UI validation notes.",
      "acceptance": "Validation passes or blockers are explicitly reported; docs are consistent with changed behavior.",
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Manual narrow-sidebar regression is still required even if automated checks pass"
      ],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "groups": [
      {
        "id": "gate",
        "title": "UI gate",
        "relation": "serial",
        "subtaskIds": ["ui-prototype-approval"],
        "dependencies": []
      },
      {
        "id": "implementation",
        "title": "Implementation changes",
        "relation": "parallel",
        "subtaskIds": ["sidebar-nowrap", "studio-child-title-display"],
        "dependencies": ["ui-prototype-approval"]
      },
      {
        "id": "followup",
        "title": "Future child naming and validation",
        "relation": "serial",
        "subtaskIds": ["sdk-child-session-info-name", "docs-validation"],
        "dependencies": ["sidebar-nowrap", "studio-child-title-display"]
      }
    ]
  }
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## 检查门禁

- UI 原型和审批记录存在。
- checker 需重点复查：窄侧栏、hover、delete confirm、archived rows、Studio child title fallback。
