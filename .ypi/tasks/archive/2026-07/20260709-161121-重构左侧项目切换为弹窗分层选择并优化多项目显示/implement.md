# implement

## 执行步骤

| 顺序 | 子任务 | 目的 | 主要文件 |
| --- | --- | --- | --- |
| 1 | FE-001 入口与状态重构 | 用顶部 switch button + modal open state 替换旧 dropdown 入口 | `components/SessionSidebar.tsx` |
| 2 | FE-002 弹窗主体 | 实现分层项目/空间选择、滚动、搜索、空状态框架 | `components/ProjectSpaceSwitchDialog.tsx`（建议新增）、`components/SessionSidebar.tsx` |
| 3 | FE-003 添加项目流程迁移 | 把默认目录、目录选择、手动路径、Git clone 表单迁移到弹窗 | `components/ProjectSpaceSwitchDialog.tsx`、`components/SessionSidebar.tsx` |
| 4 | FE-004 选择/WorkTree/副作用接线 | 保持选择后 sessions/Git/file explorer/AppShell title 联动与 WorkTree 右键 | `components/SessionSidebar.tsx` |
| 5 | FE-005 UI polish 与可访问性 | 处理大量项目、长文本、窄屏、焦点、Esc、missing 禁用 | `components/ProjectSpaceSwitchDialog.tsx`、`app/globals.css`（如需） |
| 6 | DOC-001 文档更新 | 更新前端模块说明 | `docs/modules/frontend.md` |
| 7 | QA-001 验证 | 运行自动验证并完成手工验收 | 相关变更文件 |

## 需先阅读的文件

- `AGENTS.md`
- `docs/architecture/overview.md`
- `docs/modules/frontend.md`
- `docs/modules/api.md`
- `docs/modules/library.md`
- `components/SessionSidebar.tsx`
- `components/AppShell.tsx`
- `lib/project-registry-types.ts`
- 本任务产物：`prd.md`、`design.md`、`ui.md`、`project-switch-modal-prototype.html`、`checks.md`

## 关键实现建议

1. 不改变 API 和数据模型；优先纯前端重构。
2. 保留现有 helper 和 callback 语义，避免重写 Project Registry/WorkTree 逻辑。
3. 新弹窗组件建议只做 UI 和 callback 编排；真正注册/clone/选择仍由 `SessionSidebar` 的现有函数处理。
4. 删除旧 `dropdownOpen` CWD menu 渲染，但可以保留部分 state 并重命名为 dialog/form state。
5. 实现后用临时 mock/本地 registry 验证 50+ 项目显示，不要通过扫描 sessions 生成项目。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "taskId": "20260709-161121-重构左侧项目切换为弹窗分层选择并优化多项目显示",
  "summary": "Replace the left sidebar project dropdown with a layered project/space switch modal while preserving existing Project Registry APIs and session side effects.",
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "FE-001",
      "title": "Replace sidebar CWD dropdown trigger with project-space switch button state",
      "phase": "implementing",
      "order": 1,
      "dependsOn": [],
      "files": ["components/SessionSidebar.tsx"],
      "instructions": "Introduce modal open/pending state and refactor the header CWD picker into a compact top switch button. Remove the old dropdown as the primary selection UI without changing New/WorkTree/Refresh/workspace action buttons. Preserve current WorkTree right-click affordance on the selected workspace where practical.",
      "acceptance": "Clicking the top switch button opens a modal placeholder; no sidebar dropdown is rendered for project selection; selected project/space summary remains visible and stable under narrow sidebar widths.",
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["Breaking selectedCwd initialization", "Accidentally removing WorkTree context menu access"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "FE-002",
      "title": "Build layered ProjectSpaceSwitchDialog UI",
      "phase": "implementing",
      "order": 2,
      "dependsOn": ["FE-001"],
      "files": ["components/ProjectSpaceSwitchDialog.tsx", "components/SessionSidebar.tsx"],
      "instructions": "Create a viewport-level dialog with role=dialog/aria-modal. Left pane lists active sorted projects with search; right pane lists active sorted spaces for the pending project. Display current selection, pinned status, WorkTree badges, branch/base/path summaries, missing disabled state, and independent scroll areas. Follow project style variables and the HTML prototype.",
      "acceptance": "Users can choose a project first and then a non-missing space; long project/path text ellipsizes; lists scroll inside the modal instead of overflowing the viewport.",
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["Dialog z-index conflicts", "Search flattening the required hierarchy"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "FE-003",
      "title": "Migrate add-project and Git clone flows into the dialog",
      "phase": "implementing",
      "order": 3,
      "dependsOn": ["FE-002"],
      "files": ["components/ProjectSpaceSwitchDialog.tsx", "components/SessionSidebar.tsx"],
      "instructions": "Move Use default directory, Add project folder, Add project path, and Add project from Git into the dialog. Keep manual path and Git forms mutually exclusive. Reuse existing callbacks and busy/error state. On successful register/clone, select returned main space, close the dialog, and reset temporary form state; on failure, keep current project unchanged and show error near the form.",
      "acceptance": "All existing add-project paths still work from the modal, including empty registry state; cancel/Escape/close resets transient input and errors when safe.",
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["Registration success not closing dialog", "Git clone failure accidentally switching workspace"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "FE-004",
      "title": "Wire selection side effects, WorkTree actions, and empty registry behavior",
      "phase": "implementing",
      "order": 4,
      "dependsOn": ["FE-002", "FE-003"],
      "files": ["components/SessionSidebar.tsx"],
      "instructions": "Ensure dialog space selection performs the existing setSelectedProjectId/setSelectedSpaceId/setSelectedCwd sequence and clears relevant errors. Verify loadSessions, git info loading, AppShell project context, new session cwd, explorer cwd, WorkTree archive/delete fallback, and no-project initial state continue to behave. Do not scan sessions to synthesize projects.",
      "acceptance": "Switching spaces updates sessions, Git/workspace subtitle, new session context, and file explorer. With zero active projects, the button opens an empty onboarding modal and New/WorkTree remain disabled.",
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["Race between selectedCwd and selected project effects", "Empty registry opening blank dialog"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "FE-005",
      "title": "Polish responsive, accessibility, and many-project display",
      "phase": "implementing",
      "order": 5,
      "dependsOn": ["FE-004"],
      "files": ["components/ProjectSpaceSwitchDialog.tsx", "components/SessionSidebar.tsx", "app/globals.css"],
      "instructions": "Add focus management, Escape/backdrop/close behavior, return focus to trigger, keyboard-friendly buttons, viewport-bounded max sizes, responsive single-column fallback if needed, and robust ellipsis/min-width styling. Add title/tooltips for full paths. Avoid closing while clone/validation is in unsafe busy state or make the behavior explicit.",
      "acceptance": "The dialog is operable by keyboard, does not overflow small windows, and remains readable with 50+ projects/long paths.",
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["Focus trap complexity", "Mobile/narrow viewport regressions"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "DOC-001",
      "title": "Update frontend module documentation",
      "phase": "implementing",
      "order": 6,
      "dependsOn": ["FE-005"],
      "files": ["docs/modules/frontend.md"],
      "instructions": "Update the SessionSidebar entry to describe the modal-based project/space switcher, empty registry onboarding, and preserved add-project/WorkTree capabilities. Keep AGENTS.md unchanged unless navigation changes materially.",
      "acceptance": "Docs accurately reflect the new interaction and implementation boundaries.",
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["Docs drifting from final implementation"],
      "parallelizable": true,
      "localReview": false
    },
    {
      "id": "QA-001",
      "title": "Run validation and manual UI regression checks",
      "phase": "checking",
      "order": 7,
      "dependsOn": ["FE-001", "FE-002", "FE-003", "FE-004", "FE-005", "DOC-001"],
      "files": ["components/SessionSidebar.tsx", "components/ProjectSpaceSwitchDialog.tsx", "docs/modules/frontend.md"],
      "instructions": "Run lint and TypeScript checks, then perform the manual scenarios in checks.md: normal switch, 50+ projects, WorkTree, missing space, empty registry, add path/folder/Git/default, keyboard close/focus, narrow viewport.",
      "acceptance": "All automatic checks pass and manual scenarios are reported with no blockers, or blockers are documented for follow-up.",
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "Manual checks from checks.md"],
      "risks": ["Manual data setup insufficient to reproduce many-project case"],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "groups": [
      { "id": "ui-shell", "subtasks": ["FE-001", "FE-002"] },
      { "id": "flows", "subtasks": ["FE-003", "FE-004"] },
      { "id": "polish-docs", "subtasks": ["FE-005", "DOC-001"] },
      { "id": "quality", "subtasks": ["QA-001"] }
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

- UI 原型已获用户确认。
- 代码实现满足 `checks.md` 的需求覆盖与手工场景。
- lint/tsc 通过。
- 文档更新完成。
