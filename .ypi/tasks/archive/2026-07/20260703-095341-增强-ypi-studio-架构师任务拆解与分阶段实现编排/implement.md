# Implement — 分阶段实现计划

## 总体执行策略

1. 先实现阶段一 MVP：类型/持久化、工具/API 保存、prompt 约束、Studio UI 展示、文档更新。
2. 再实现阶段二：next ready 选择、claim/run 绑定、子任务状态推进、单子任务重跑/补查记录、widget 轻量摘要。
3. 每个子任务都应独立提交给实现员执行；如果父会话派发实现员，必须带 `subtaskId`，不要让实现员一次性实现全部计划。
4. 主任务在计划完成后必须停在 `awaiting_approval` 等待用户确认；用户确认后才能进入 `implementing` 并领取子任务。

## 需先阅读的文件

- `AGENTS.md`
- `docs/architecture/overview.md`
- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `docs/standards/code-style.md`
- `lib/ypi-studio-types.ts`
- `lib/ypi-studio-tasks.ts`
- `lib/ypi-studio-extension.ts`
- `lib/ypi-studio-agents.ts`
- `lib/ypi-studio-session-link.ts`
- `components/YpiStudioPanel.tsx`
- `components/YpiStudioSessionWidget.tsx`
- `app/api/studio/tasks/[taskKey]/route.ts`
- `app/api/studio/tasks/route.ts`

## Implementation Plan

### 人类可读子任务表

| ID | 阶段 | 状态建议 | 目标 | 主要文件 | 验收重点 |
| --- | --- | --- | --- | --- | --- |
| `mvp-types-data` | MVP | ready | 增加 implementation plan/progress 类型、normalizer、summary 派生 | `lib/ypi-studio-types.ts`, `lib/ypi-studio-tasks.ts` | 旧任务兼容；新字段可保存和读取；counts/next 摘要正确 |
| `mvp-api-tool` | MVP | pending | API 和 `ypi_studio_task` 支持保存计划/进度初始值 | `app/api/studio/tasks/[taskKey]/route.ts`, `lib/ypi-studio-extension.ts` | `GET` 返回字段；`PATCH/tool` 可保存；审批门禁未绕过 |
| `mvp-prompts-docs` | MVP | pending | 更新默认成员 prompt 与模块文档 | `lib/ypi-studio-agents.ts`, `docs/modules/*.md`, `docs/architecture/overview.md` | 架构师输出结构化计划；实现员按子任务边界；文档同步 |
| `mvp-ui-panel` | MVP | pending | Studio UI 展示子任务列表、状态和当前项 | `components/YpiStudioPanel.tsx` | 空态/旧任务/归档/阻塞/长列表可读；任务卡片有摘要 |
| `phase2-dispatch-core` | Phase 2 | pending | 自动选择 next ready、claim、状态推进、依赖检查 | `lib/ypi-studio-tasks.ts`, `lib/ypi-studio-types.ts` | 串行 claim；依赖不满足不选；只在 implementing 内运行 |
| `phase2-subagent-binding` | Phase 2 | pending | `ypi_studio_subagent` 支持 `subtaskId` 并记录 run/progress 关联 | `lib/ypi-studio-extension.ts`, `lib/ypi-studio-tasks.ts` | 实现员 prompt 只包含指定子任务边界；run 关联可在 UI 看到 |
| `phase2-rerun-review-widget` | Phase 2 | pending | 支持单子任务重跑/补查记录，预留并行与局部 checker review，widget 摘要 | `lib/ypi-studio-types.ts`, `components/YpiStudioPanel.tsx`, `components/YpiStudioSessionWidget.tsx`, `lib/ypi-studio-session-link.ts` | done/blocked 可重置 ready；localReview 可记录；widget 不加载长文本 |
| `validation` | Both | pending | 自动验证、手工验收和风险复核 | `scripts/` 可选新增轻量测试 | lint、tsc、Studio 手工流程通过 |

### 机器可读计划

```json ypi-implementation-plan
{
  "schemaVersion": 1,
  "updatedAt": "2026-07-03T00:00:00.000Z",
  "sourceArtifact": "implement.md",
  "summary": "Add a structured implementation breakdown layer to YPI Studio without changing the main workflow state machine or weakening awaiting_approval.",
  "strategy": "Ship MVP data/prompt/UI first, then add serial ready-subtask scheduling and per-subtask execution tracking.",
  "maxConcurrency": 1,
  "subtasks": [
    {
      "id": "mvp-types-data",
      "title": "Add implementation plan/progress data model and persistence normalization",
      "phase": "mvp",
      "order": 10,
      "dependsOn": [],
      "files": [
        "lib/ypi-studio-types.ts",
        "lib/ypi-studio-tasks.ts"
      ],
      "instructions": [
        "Add implementation subtask status, plan, progress, summary, and optional localReview types.",
        "Extend task record/detail/summary with optional implementationPlan and implementationProgress.",
        "Normalize old task.json files safely when fields are absent or malformed.",
        "Add pure helpers for counts, activeSubtaskId, nextSubtaskId, dependency satisfaction, and progress initialization."
      ],
      "acceptance": [
        "Existing tasks without the new fields still list and open normally.",
        "A task with implementationPlan/progress returns those fields from getYpiStudioTaskDetail.",
        "Progress counts cover pending/ready/running/blocked/done/skipped."
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Malformed user-edited task.json must not crash task list scanning."
      ],
      "parallelizable": false,
      "localReview": { "required": false, "reviewer": "checker" }
    },
    {
      "id": "mvp-api-tool",
      "title": "Expose plan save/read through task API and ypi_studio_task",
      "phase": "mvp",
      "order": 20,
      "dependsOn": ["mvp-types-data"],
      "files": [
        "app/api/studio/tasks/[taskKey]/route.ts",
        "lib/ypi-studio-extension.ts",
        "lib/ypi-studio-tasks.ts"
      ],
      "instructions": [
        "Add PATCH body validation for update_implementation_plan.",
        "Add ypi_studio_task action update_implementation_plan and tool schema fields.",
        "Return implementation fields in tool details and API detail responses.",
        "Do not allow this action to transition to implementing or bypass approval."
      ],
      "acceptance": [
        "Plan can be saved to task.json through API/tool.",
        "Saved plan initializes implementationProgress.",
        "awaiting_approval -> implementing still requires existing approvalGrant; override does not bypass."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Tool parameter schema must stay backward compatible for existing action inputs."
      ],
      "parallelizable": false,
      "localReview": { "required": false, "reviewer": "checker" }
    },
    {
      "id": "mvp-prompts-docs",
      "title": "Update architect/implementer/checker prompts and documentation",
      "phase": "mvp",
      "order": 30,
      "dependsOn": ["mvp-types-data", "mvp-api-tool"],
      "files": [
        "lib/ypi-studio-agents.ts",
        "lib/ypi-studio-extension.ts",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/architecture/overview.md"
      ],
      "instructions": [
        "Require architect implement.md to include a readable Implementation Plan and fenced JSON plan block.",
        "Require implementer to read implementationPlan/progress first and execute only the assigned subtaskId.",
        "Tell parent session to save plan, transition only to awaiting_approval, and stop for user confirmation.",
        "Document new API/tool/data/UI behavior."
      ],
      "acceptance": [
        "Default member templates reflect the new responsibilities.",
        "Existing exact-match default member files can be safely backfilled; custom members are not overwritten.",
        "Docs mention approval gate and implementing-only subtask progress."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Project-local .ypi/agents may be custom; do not overwrite user edits."
      ],
      "parallelizable": false,
      "localReview": { "required": false, "reviewer": "checker" }
    },
    {
      "id": "mvp-ui-panel",
      "title": "Display implementation subtasks in Studio task UI",
      "phase": "mvp",
      "order": 40,
      "dependsOn": ["mvp-types-data"],
      "files": [
        "components/YpiStudioPanel.tsx",
        "docs/modules/frontend.md"
      ],
      "instructions": [
        "Add an Implementation tab or section to task detail.",
        "Render subtask status badges, phase/order, dependencies, files, acceptance, validation, runIds, blocked/skipped reasons.",
        "Add task card/overview summary for done/total, active, next ready, blocked count.",
        "Cover empty state for old tasks and read-only rendering for archived tasks."
      ],
      "acceptance": [
        "Studio UI can show子任务列表和状态.",
        "Current running item and blocked items are visible.",
        "Long text does not break the drawer layout."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Manual: open Studio panel task detail with and without implementationPlan"
      ],
      "risks": [
        "Panel already has many tabs; avoid overloading overview."
      ],
      "parallelizable": true,
      "parallelGroup": "mvp-ui",
      "localReview": { "required": false, "reviewer": "checker" }
    },
    {
      "id": "phase2-dispatch-core",
      "title": "Add serial next-ready selection, claim, and subtask status transitions",
      "phase": "phase2",
      "order": 50,
      "dependsOn": ["mvp-types-data", "mvp-api-tool"],
      "files": [
        "lib/ypi-studio-types.ts",
        "lib/ypi-studio-tasks.ts",
        "app/api/studio/tasks/[taskKey]/route.ts",
        "lib/ypi-studio-extension.ts"
      ],
      "instructions": [
        "Implement next-ready selection ordered by order/id and gated by dependsOn done/skipped.",
        "Implement claim_implementation_subtask that sets ready -> running and activeSubtaskId.",
        "Implement update_implementation_subtask for pending/ready/running/blocked/done/skipped with history.",
        "Reject claim/running/done mutations unless task.status is implementing."
      ],
      "acceptance": [
        "Automatic selection returns the first ready dependency-satisfied subtask.",
        "Claim is serial when maxConcurrency is 1 and an active running subtask exists.",
        "Subtask progress can move through pending/ready/running/blocked/done/skipped.",
        "Override cannot be used to start implementation before approval."
      ],
      "validation": [
        "Add or run a lightweight script for pure scheduling helpers if practical",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Status transitions need conservative validation to avoid corrupting task progress."
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "phase2-subagent-binding",
      "title": "Bind implementer/checker runs to a single implementation subtask",
      "phase": "phase2",
      "order": 60,
      "dependsOn": ["phase2-dispatch-core"],
      "files": [
        "lib/ypi-studio-extension.ts",
        "lib/ypi-studio-tasks.ts",
        "lib/ypi-studio-types.ts",
        "components/YpiStudioPanel.tsx"
      ],
      "instructions": [
        "Add optional subtaskId to ypi_studio_subagent input and run records.",
        "Inject only the selected subtask's boundary into implementer prompt, plus compact plan/progress context.",
        "Record runIds/lastRunId on the matching subtask progress when a run starts/finishes.",
        "Leave final done/blocked/skipped decision to explicit parent-session tool action."
      ],
      "acceptance": [
        "Implementer can be dispatched for one subtask and does not default to full implementation.",
        "UI shows which member run belongs to which subtask.",
        "Checker can optionally receive subtaskId for local review."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Manual: dispatch one implementer run with subtaskId in a test task"
      ],
      "risks": [
        "The parent model may still ask broad prompts; prompt guidelines must be explicit."
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "phase2-rerun-review-widget",
      "title": "Support rerun/check extensions and lightweight widget summary",
      "phase": "phase2",
      "order": 70,
      "dependsOn": ["phase2-subagent-binding"],
      "files": [
        "lib/ypi-studio-types.ts",
        "lib/ypi-studio-session-link.ts",
        "components/YpiStudioPanel.tsx",
        "components/YpiStudioSessionWidget.tsx",
        "docs/modules/frontend.md",
        "docs/modules/library.md"
      ],
      "instructions": [
        "Allow blocked/done/skipped subtasks to be reset to ready with reason and attempt history preserved.",
        "Record localReview requested/running/passed/failed/skipped and checker runIds.",
        "Expose lightweight implementation summary in session widget projection.",
        "Keep parallelGroup/maxConcurrency as display/reserved metadata; do not implement actual parallel dispatch unless explicitly requested."
      ],
      "acceptance": [
        "A single subtask can be re-executed without resetting the whole task.",
        "A single subtask can record supplemental checker review status.",
        "Widget or task card can show active/next subtask without loading full plan text.",
        "Parallel extension fields exist but runtime remains serial by default."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Manual: reset one done/blocked subtask to ready and verify history/UI"
      ],
      "risks": [
        "UI actions for rerun/check can imply automation; label them clearly if implemented."
      ],
      "parallelizable": true,
      "parallelGroup": "phase2-ui-docs",
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "validation",
      "title": "Run validation and prepare checker handoff",
      "phase": "both",
      "order": 80,
      "dependsOn": [
        "mvp-ui-panel",
        "mvp-prompts-docs",
        "phase2-rerun-review-widget"
      ],
      "files": [
        "docs/standards/code-style.md",
        "package.json"
      ],
      "instructions": [
        "Run lint and TypeScript checks.",
        "If pure scheduling helper tests were added, run that script and document it.",
        "Manually verify a task with no plan, a task with a plan, claim/update behavior, and the approval gate.",
        "Prepare handoff for checker with changed files, validation results, and known risks."
      ],
      "acceptance": [
        "npm run lint passes.",
        "node_modules/.bin/tsc --noEmit passes.",
        "Manual acceptance covers approval gate, UI display, and one-subtask dispatch path."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Manual Studio flow needs a real or test task in .ypi/tasks."
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    }
  ]
}
```

## 建议实现顺序

### 阶段一：MVP

1. `mvp-types-data`
   - 在 `lib/ypi-studio-types.ts` 添加类型。
   - 在 `normalizeTaskRecord()` 中读取可选字段。
   - 在 `recordToSummary()` / `recordToDetail()` 返回实现摘要和完整计划。
   - 增加 `buildImplementationProgress()`、`implementationCounts()` 等纯 helper。
2. `mvp-api-tool`
   - 新增 plan 保存函数和 PATCH body validator。
   - 扩展 `ypi_studio_task` action schema 与执行逻辑。
   - 验证保存 plan 不触发状态迁移。
3. `mvp-prompts-docs`
   - 更新默认 `architect` / `implementer` / `checker` 文案。
   - 更新 extension 注入文本和模块文档。
4. `mvp-ui-panel`
   - UI 读取新增 detail 字段。
   - 任务卡片和详情页展示 implementation summary/list。

### 阶段二：自动调度与细粒度执行

5. `phase2-dispatch-core`
   - 实现 next/claim/status update。
   - 加严格主状态 gate。
6. `phase2-subagent-binding`
   - `ypi_studio_subagent` 接收/记录 `subtaskId`。
   - 修改实现员 member prompt 构造。
7. `phase2-rerun-review-widget`
   - 增加重跑、补查、widget 摘要和预留并行字段展示。
8. `validation`
   - 自动验证 + 手工 Studio 流程 + checker handoff。

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-policy
```

如新增纯调度 helper 测试脚本，补充运行：

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-ypi-studio-implementation-plan.mjs
```

## 评审门禁

- 必须先通过用户确认，主任务从 `awaiting_approval` 合法进入 `implementing` 后，才允许执行任何实现子任务。
- 实现员每次只接收一个 `subtaskId`。
- 改动涉及事件种类、JSON 字段、API payload、prompt 和 docs 时，必须搜索并更新所有消费者。
- 不运行 `next build` 作为常规验证；如需发布验证使用 `npm run build`。
