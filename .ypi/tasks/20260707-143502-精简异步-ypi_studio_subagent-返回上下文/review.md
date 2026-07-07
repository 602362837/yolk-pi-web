# Check Complete

## Verdict
Pass

## 检查范围
- `lib/ypi-studio-extension.ts`：`ypi_studio_subagent` async start / poll / collect / cancel / wait 的轻量返回投影
- `components/YpiStudioSubagentTranscript.tsx`：`run.id ?? run.runId`、task/subtask title 兼容
- `components/ChatWindow.tsx`、`components/YpiStudioSessionWidget.tsx`、`components/YpiStudioWaitPanel.tsx`：轻量 run/title overlay 与 wait 展示兼容
- `lib/ypi-studio-types.ts`：overlay title 字段补充
- `docs/modules/library.md`、`docs/modules/frontend.md`：文档同步

## Verification
- `npm run lint` — passed
- `node_modules/.bin/tsc --noEmit` — passed

## Findings Fixed
- None

## Remaining Findings
- None

## Notes
- async start 已切到 `ypi_studio_subagent_async_start_v1` 轻量投影，仅保留 task identity、run identity/member/model/thinking/startedAt、小 progress、wait hint、短 warnings。
- `poll` / `collect` / `cancel` 已切到 `ypi_studio_subagent_lifecycle_v1`，不再返回 task compact、implementationProjection、recent events、transcriptPreview、progress.itemsPreview。
- `ypi_studio_wait` 仍保持 compact，并补了 `id`/`runId`、`taskKey` 兼容字段。
- UI 已兼容 `run.id ?? run.runId`，并优先显示 `subtaskTitle ?? taskTitle ?? taskId`。
- 本次未做真实 async start + wait 的手工 UI smoke；静态检查、文档对齐、lint/tsc 已通过。

## 建议
- 建议完成并归档；如需更高信心，可补做一次 async start → wait → collect 的手工 smoke。
