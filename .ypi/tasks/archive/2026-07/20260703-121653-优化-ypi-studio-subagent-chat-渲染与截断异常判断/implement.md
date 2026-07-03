# implement

## 需先阅读的文件

1. `docs/architecture/overview.md`
2. `docs/modules/frontend.md`
3. `docs/modules/library.md`
4. `components/YpiStudioSubagentTranscript.tsx`
5. `components/MessageView.tsx`
6. `components/ChatWindow.tsx`
7. `hooks/useAgentSession.ts`
8. `lib/ypi-studio-extension.ts`
9. `lib/ypi-studio-transcripts.ts`
10. `lib/ypi-studio-types.ts`
11. `lib/ypi-studio-session-link.ts`
12. `components/YpiStudioSessionWidget.tsx`

## 执行步骤

| Order | ID | Title | Phase | 说明 |
| --- | --- | --- | --- | --- |
| 1 | `subtask-contract-truncation-severity` | 区分截断 severity 与运行失败 | library | 增加 optional display/truncation/terminationReason 字段，或最小化在 UI 分类旧字段。 |
| 2 | `subtask-backend-recent-progress` | 后端输出固定最近进展窗口 | library | 将 live `itemsPreview` 语义收敛为最近 5 条，并标注 preview/final/capture 限制。 |
| 3 | `subtask-chat-tool-ui` | 主 Chat 工具块渲染优化 | frontend | 标题直显 `t/s`，默认展开只显示状态和最近进展，截断显示为 info。 |
| 4 | `subtask-widget-docs` | Widget/文档同步 | frontend/docs | 让 session widget 不把 projection 截断当异常，并更新模块文档。 |
| 5 | `subtask-validation` | 自动与手工验收 | checks | lint/tsc + 手工触发成功、截断、失败三类场景。 |

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 1,
  "summary": "Separate YPI Studio subagent run failure from display truncation, show token speed in the main chat tool header, and keep only a bounded recent activity window by default.",
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "subtask-contract-truncation-severity",
      "title": "Define truncation severity and compatible wire fields",
      "phase": "library",
      "order": 10,
      "dependsOn": [],
      "files": [
        "lib/ypi-studio-types.ts",
        "lib/ypi-studio-transcripts.ts",
        "lib/ypi-studio-extension.ts"
      ],
      "instructions": [
        "Keep run status as the only source for failed/cancelled/waiting severity.",
        "Add optional fields for display/truncation metadata if implementing the full design: progress.display and transcript.truncation.",
        "Keep transcript.truncated backward compatible; do not let old true values imply failure.",
        "Represent hard-limit termination separately with an optional terminationReason or existing failed status/error text."
      ],
      "acceptance": [
        "Successful runs with item/API preview truncation remain status=succeeded.",
        "Hard limits still produce failed/cancelled/waiting statuses.",
        "Older task.json records without new fields still normalize correctly."
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "rg -n \"transcript\\.truncated|Assistant output exceeded|Transcript response was truncated\" components lib"
      ],
      "risks": [
        "Changing persisted shape too aggressively could break historical tasks; use optional fields only."
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "implementer" }
    },
    {
      "id": "subtask-backend-recent-progress",
      "title": "Bound live recent progress and classify display limits",
      "phase": "library",
      "order": 20,
      "dependsOn": ["subtask-contract-truncation-severity"],
      "files": [
        "lib/ypi-studio-extension.ts",
        "lib/ypi-studio-transcripts.ts"
      ],
      "instructions": [
        "Set the default live itemsPreview window to a small fixed count, recommended 5.",
        "Ensure progressPayload replaces the recent window instead of appending old items.",
        "Classify final output clipping as display/result clipping, not run failure.",
        "Keep stdout/stderr/line/idle/runtime limit termination behavior unchanged."
      ],
      "acceptance": [
        "During a long run, partialResult.details.run.progress.itemsPreview never exceeds the agreed recent limit.",
        "New progress events replace older displayed items.",
        "Warnings for display clipping are phrased as display notes, not child failure."
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "Manual long-output Studio member run or mocked progress payload inspection"
      ],
      "risks": [
        "Too small a window may hide useful context; Debug transcript remains available."
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "implementer" }
    },
    {
      "id": "subtask-chat-tool-ui",
      "title": "Optimize main Chat ypi_studio_subagent tool UI",
      "phase": "frontend",
      "order": 30,
      "dependsOn": ["subtask-contract-truncation-severity", "subtask-backend-recent-progress"],
      "files": [
        "components/YpiStudioSubagentTranscript.tsx",
        "components/MessageView.tsx"
      ],
      "instructions": [
        "Render tps as a visible badge in the collapsed tool header when available.",
        "Base border/color severity on run.status/result.isError, not transcript.truncated alone.",
        "Default expanded view should show Status and Recent activity only; keep delegated prompt, full transcript, raw JSON, and tool args/results behind Debug/Raw toggles.",
        "Cap default compactItems/recent activity at the agreed limit, recommended 5."
      ],
      "acceptance": [
        "A running Studio member shows member/status/phase/tps without expanding the tool.",
        "A successful run with transcript.truncated=true shows an info note, not a failure warning.",
        "Expanded default content never renders an unbounded transcript list.",
        "Debug/Raw still allows diagnosis when explicitly opened."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Manual browser check of running, succeeded-with-clipping, and failed cases"
      ],
      "risks": [
        "Users who relied on default visible details may need to open Debug; copy should make this discoverable."
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "implementer" }
    },
    {
      "id": "subtask-widget-docs",
      "title": "Align session widget and documentation",
      "phase": "frontend-docs",
      "order": 40,
      "dependsOn": ["subtask-contract-truncation-severity"],
      "files": [
        "components/ChatWindow.tsx",
        "components/YpiStudioSessionWidget.tsx",
        "lib/ypi-studio-session-link.ts",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/architecture/overview.md"
      ],
      "instructions": [
        "If new display/truncation fields are added, include them in ChatWindow's studioProgressSignature when needed for live widget refresh.",
        "Ensure session widget preview treats API projection limits as display notes, not run failures.",
        "Update docs to state that ypi_studio_subagent default UI is recent-status-first and truncation is not equivalent to child failure."
      ],
      "acceptance": [
        "Session widget still shows tps/phase for live runs.",
        "Docs identify hard-limit failures separately from preview/transcript clipping.",
        "No unrelated generic subagent behavior changes."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Widget and Chat could diverge if they classify warnings independently; prefer shared helper if logic grows."
      ],
      "parallelizable": true,
      "localReview": { "required": false }
    },
    {
      "id": "subtask-validation",
      "title": "Validate and review behavior",
      "phase": "checks",
      "order": 50,
      "dependsOn": [
        "subtask-chat-tool-ui",
        "subtask-widget-docs"
      ],
      "files": [
        "components/YpiStudioSubagentTranscript.tsx",
        "lib/ypi-studio-extension.ts",
        "lib/ypi-studio-transcripts.ts",
        "docs/modules/frontend.md"
      ],
      "instructions": [
        "Run lint and TypeScript checks.",
        "Manually trigger a YPI Studio member run and confirm title tps and recent activity window.",
        "Test or simulate a successful clipped transcript and verify it is not shown as abnormal.",
        "Test or simulate a real failed/cancelled run and verify failure styling remains clear."
      ],
      "acceptance": [
        "Validation commands pass.",
        "Manual results cover success, display clipping, and real failure.",
        "No production code is committed without main-session approval."
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:studio-policy"
      ],
      "risks": [
        "Live tps depends on child model streaming/usage events; fallback may be estimated_chars."
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    }
  ]
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-policy
```

## 手工验收建议

1. 启动 `npm run dev`。
2. 创建/继续 YPI Studio task，触发一次 `ypi_studio_subagent(member=architect)`。
3. 运行中确认工具标题直接显示 `xx t/s`，展开后最多显示最近 5 条进展。
4. 构造长输出或使用已有长 transcript，确认截断是中性 info，不是失败样式。
5. 构造失败/取消场景，确认仍显示 red/error 与恢复建议。

## 检查门禁

- 不把 preview/item/API truncation 作为异常状态。
- 不在默认 UI 渲染完整 transcript/raw/tool args。
- 不破坏 `subagent` / `trellis_subagent`。
- 不让 live progress 在前端无限累积。
