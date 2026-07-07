# Implement — 精简异步 `ypi_studio_subagent` 返回上下文

## 执行顺序总览

| 顺序 | 子任务 | 目标 | 可并行 |
| --- | --- | --- | --- |
| 1 | light-projection-helpers | 在 `lib/ypi-studio-extension.ts` 建立轻量 task/run projection 边界 | 否 |
| 2 | async-start-light-result | async start final result/启动 onUpdate 使用极轻量 projection，并阻断 child 后续 onUpdate 注入 start tool | 否 |
| 3 | lifecycle-actions-light-result | poll/collect/cancel 改用轻量 lifecycle projection | 可在 2 后并行 UI |
| 4 | ui-runid-title-compat | UI 兼容 `id/runId`、任务标题、缺失 transcript/progress items | 可在 2 后并行 lifecycle |
| 5 | docs-and-validation | 更新模块文档并执行 lint/tsc | 否 |

## 需先阅读的文件

- `docs/modules/library.md`
- `docs/modules/frontend.md`
- `lib/ypi-studio-extension.ts`
- `lib/ypi-studio-child-session-runner.ts`（确认 async child onUpdate 传入点）
- `components/YpiStudioSubagentTranscript.tsx`
- `components/YpiStudioWaitPanel.tsx`
- `components/ChatWindow.tsx`
- `lib/ypi-studio-types.ts`（如扩展 live overlay title 字段）

## 关键实现约束

- 不改变同步 `ypi_studio_subagent` final result 行为。
- 不改变 wait 输入/等待语义。
- 不改变 task.json/transcript sidecar 持久化；只改变工具 result/details 投影。
- async start details 不得包含：`implementationProjection`、`events`、`artifacts`、`subagents`、`transcriptPreview`、`progress.itemsPreview`、完整 `policy`。
- UI 必须能从轻量 result 显示 member/status/model/thinking/runId/title。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 1,
  "taskId": "20260707-143502-精简异步-ypi_studio_subagent-返回上下文",
  "summary": "为 ypi_studio_subagent(action=start, mode=async) 建立极轻量启动投影，poll/collect/cancel 使用轻量 lifecycle 投影，wait 保持 compact，并补齐 UI 对 runId/title 的兼容。",
  "subtasks": [
    {
      "id": "light-projection-helpers",
      "title": "建立 Studio subagent 轻量投影辅助函数",
      "phase": "implementation",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/ypi-studio-extension.ts"
      ],
      "instructions": [
        "新增 task identity helper，仅返回 id/key/title/status/workflowId。",
        "新增 async start run projection helper，同时输出 id 与 runId，包含 taskId/taskKey/taskTitle/subtaskTitle/member/status/model/thinking/modelSource/thinkingSource/runner/startedAt/极短 progress。",
        "新增 lifecycle run projection helper，用于 poll/collect/cancel，包含短 summary/error、terminal transcript ref metadata，但不包含 transcriptPreview/progress.itemsPreview/requestAffinity/policy。",
        "为 projectSubagentRun 增加 options（例如 includeTranscriptPreview），默认保持旧行为；wait 和轻量 lifecycle 路径传 false，避免无用读取 transcript preview。",
        "为 compactSubagentRunForWait 增加 id: runId 和 taskKey 小字段，保持 wait payload compact。"
      ],
      "acceptance": [
        "轻量 task helper 不返回 artifacts/events/subagents/implementationProjection/readHints。",
        "async start helper 不返回 prompt/transcript/transcriptPreview/progress.itemsPreview/full policy/requestAffinity。",
        "原同步路径调用 compactSubagentRunProjection 的行为保持可用。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "helper 默认参数若设置错误可能影响同步 start 的 debug 展示；默认应保持 includeTranscriptPreview=true。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "focus": [
          "投影字段白名单",
          "默认行为兼容",
          "无 transcriptPreview 泄漏"
        ]
      }
    },
    {
      "id": "async-start-light-result",
      "title": "将 async start final result 与启动 onUpdate 改为极轻量投影",
      "phase": "implementation",
      "order": 2,
      "dependsOn": [
        "light-projection-helpers"
      ],
      "files": [
        "lib/ypi-studio-extension.ts"
      ],
      "instructions": [
        "在 mode === async 的初始 onUpdate 中使用 task identity + async start run projection；sync 模式保留原 onUpdate。",
        "启动 child runner 时，async 模式不要把原始 onUpdate 继续传入 SDK/CLI child runner；只保留 persistence callbacks 写 task/transcript/runtime registry。",
        "async final result details 使用 projection=ypi_studio_subagent_async_start_v1、task identity、async start run projection、wait hint（tool/taskId/taskKey/runId/runIds/until/recommended）。",
        "warnings 仅保留短字符串数组；不注入 policy diagnostics 对象。",
        "content 文本保持短启动确认，并明确建议调用 ypi_studio_wait(runId=...)。"
      ],
      "acceptance": [
        "async start details 不再包含 compactYpiStudioTaskForTool 输出。",
        "async start details.run 不包含 transcriptPreview/progress.itemsPreview/prompt/full policy。",
        "async child 后续进展仍写入 task.json/transcript，并可被 ypi_studio_wait 读取。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "如果编排模型未调用 wait，start 卡片不会继续更新；通过 wait prompt guideline、session widget polling 和 terminal continuation 缓解。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "focus": [
          "async/sync 分支隔离",
          "child persistence 未受影响",
          "wait hint 完整"
        ]
      }
    },
    {
      "id": "lifecycle-actions-light-result",
      "title": "精简 poll/collect/cancel 工具结果",
      "phase": "implementation",
      "order": 3,
      "dependsOn": [
        "light-projection-helpers"
      ],
      "files": [
        "lib/ypi-studio-extension.ts"
      ],
      "instructions": [
        "poll/collect 路径把 details.task 从 compactYpiStudioTaskForTool 改为 task identity。",
        "poll/collect/cancel 的 details.runs/run 使用 lifecycle projection。",
        "collect 在所有 requested runs terminal 时可返回短 nextRecommendedAction，便于未使用 wait 的旧编排继续；不要返回完整 task compact。",
        "cancel 保持幂等取消语义，返回取消后的轻量 run 状态和短 error/terminationReason。",
        "wait 路径调用 projectSubagentRun 时跳过 transcriptPreview 读取，并保持 compactSubagentRunForWait 输出小。"
      ],
      "acceptance": [
        "poll/collect/cancel details 不含 implementationProjection/events/artifacts/subagents/transcriptPreview/progress.itemsPreview。",
        "collect terminal 仍能看到 run status、member、summary/error、terminationReason、startedAt/finishedAt。",
        "wait 返回结构仍被 YpiStudioWaitPanel 正常解析。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "旧调试习惯可能依赖 collect 的 transcriptPreview；保留 transcript ref metadata，并通过 transcript API 获取完整内容。"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "focus": [
          "poll/collect/cancel 字段白名单",
          "wait compact 不回退变厚",
          "terminal 错误状态 isError 语义保持"
        ]
      }
    },
    {
      "id": "ui-runid-title-compat",
      "title": "补齐 UI 对轻量 runId/title 投影的兼容",
      "phase": "implementation",
      "order": 4,
      "dependsOn": [
        "async-start-light-result"
      ],
      "files": [
        "components/YpiStudioSubagentTranscript.tsx",
        "components/ChatWindow.tsx",
        "components/YpiStudioWaitPanel.tsx",
        "lib/ypi-studio-types.ts"
      ],
      "instructions": [
        "YpiStudioSubagentTranscript.normalizeRun 使用 id ?? runId，增加 taskTitle/subtaskTitle 字段读取。",
        "Subagent header/meta 显示 subtaskTitle ?? taskTitle ?? taskId，确保轻量 start 卡片有标题。",
        "ChatWindow live overlay runId 读取改为 run.id ?? run.runId ?? progress.args.runId；如扩展 overlay type，加入 taskTitle/subtaskTitle 可选字段。",
        "确认缺失 transcript、progress.itemsPreview、policy 时组件只降级展示，不报错。",
        "YpiStudioWaitPanel 只需确认兼容；如 wait run 增加 id/taskKey，不破坏现有 runId 解析。"
      ],
      "acceptance": [
        "async start 卡片至少展示 member/status/model/thinking/runId/title。",
        "ChatWindow overlay 能从轻量 details 提取 runId/member/model/thinking/status。",
        "wait 卡片继续显示 task title、run status、phase/current tool/tps/summary。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "新增 title 字段若只在 run projection 中提供，旧 result 不显示标题；应保持 taskId fallback。"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "focus": [
          "runId fallback",
          "缺字段降级",
          "无 layout 噪音"
        ]
      }
    },
    {
      "id": "docs-and-validation",
      "title": "更新模块文档并完成验证",
      "phase": "checks",
      "order": 5,
      "dependsOn": [
        "async-start-light-result",
        "lifecycle-actions-light-result",
        "ui-runid-title-compat"
      ],
      "files": [
        "docs/modules/library.md",
        "docs/modules/frontend.md"
      ],
      "instructions": [
        "更新 library 文档中 ypi-studio-extension 描述：async start light projection、poll/collect/cancel lifecycle projection、wait compact、async child progress 由 wait 承接。",
        "更新 frontend 文档中 YpiStudioSubagentTranscript/ChatWindow/YpiStudioWaitPanel 对轻量字段和 runId/title 兼容的描述。",
        "运行 lint 与 TypeScript 检查。",
        "人工检查 diff，确认没有生产代码外的无关改动。"
      ],
      "acceptance": [
        "docs 与代码契约一致。",
        "npm run lint 通过。",
        "node_modules/.bin/tsc --noEmit 通过。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "文档若未同步，后续 agent 可能重新引入厚投影；需明确字段边界。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "focus": [
          "文档/代码一致性",
          "验收标准覆盖",
          "无回归风险遗漏"
        ]
      }
    }
  ]
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## 人工验收建议

1. 在开发环境发起一个 `ypi_studio_subagent(action=start, mode=async)`，检查 tool result raw details 是否只有 light task/run/wait/warnings。
2. 立即调用 `ypi_studio_wait(runId=...)`，确认等待、进展、终态 summary 正常。
3. 对同一 run 调用 `ypi_studio_subagent(action=collect, runId=...)`，确认不会返回 task compact/transcriptPreview。
4. 在 Chat UI 展开 subagent start 卡片和 wait 卡片，确认标题、member、status、model、thinking、runId 均可读且无报错。

## 检查门禁

- 未通过 lint/tsc 不进入 review。
- async start raw details 出现 `implementationProjection`、`events`、`artifacts`、`subagents`、`transcriptPreview`、`progress.itemsPreview` 任一字段则视为未完成。
- 若同步 `ypi_studio_subagent` 行为被误改，需要回滚或单独说明。