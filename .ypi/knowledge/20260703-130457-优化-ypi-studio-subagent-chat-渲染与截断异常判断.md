# 优化 YPI Studio subagent Chat 渲染与截断异常判断

- Task: 20260703-121653-优化-ypi-studio-subagent-chat-渲染与截断异常判断
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260703-121653-优化-ypi-studio-subagent-chat-渲染与截断异常判断
- Archived at: 2026-07-03T05:04:57.749Z
- Tags: feature-dev, ypi-studio, subagent-ui, truncation, task-binding, studio

## Summary
已完成并归档：优化 YPI Studio subagent Chat 渲染与截断异常判断。关键可复用结论：display/storage 截断（transcript.truncated、preview/item/API/final-output clipping）不等于子代理失败，UI 严重程度必须由 run.status/result.isError/hard termination reason 决定；默认 Chat 展示应 recent-status-first，标题直显 member/status/phase/current action/tps，展开只显示最近 5 条进展，prompt/raw/tool args/results 放 Debug/Raw；后端 progress.itemsPreview 固定最近窗口并用 display/truncation/terminationReason 可选字段区分展示限制与真实终止；task list/detail 绑定/继续只绑定当前 pi_<sessionId> context，不授予 approval、不绕过 awaiting_approval -> implementing 门禁。验证通过 lint、tsc、test:studio-policy 与 checker review。

## Reusable knowledge
# Summary

已完成 YPI Studio `ypi_studio_subagent` Chat 展示优化：区分 display/storage 截断与真实子代理失败，主 Chat 工具标题直显 `t/s`，默认只展示最近 5 条活动，详细 prompt/raw/tool 输入输出放入 Debug/Raw，并增加 Studio 任务列表/详情“绑定/继续到当前聊天”能力。自动验证 `npm run lint`、`node_modules/.bin/tsc --noEmit`、`npm run test:studio-policy` 均通过，checker review 通过。

# Reusable knowledge

- `transcript.truncated=true` 是兼容/展示元数据，不能单独作为失败依据；失败样式应来自 `run.status`、`result.isError` 或 hard termination reason。
- preview/item/API projection/final-output clipping 应用中性 display note 呈现；stdout/stderr/单行超限、idle/max-runtime、abort、非零退出仍是真实失败/取消/等待状态。
- `YpiStudioSubagentRunProgress.display`、`transcript.truncation`、`terminationReason` 可作为兼容可选字段，帮助 UI 精准区分展示限制和真实终止。
- live `itemsPreview` 应是替换式固定窗口（本次为 5），避免前端 DOM/内存无限增长。
- 默认子代理 UI 采用 recent-status-first：标题显示 member/status/phase/current action/tps；展开只显示状态与最近活动；prompt、tool args/results、full transcript、raw JSON 仅 Debug/Raw 显式查看。
- Studio task list/detail 的“绑定/继续到当前聊天”复用 `PATCH /api/studio/tasks/[taskKey]` 的 `{ action: "bind", contextId }`，只绑定 context，不授予 approval，也不绕过 awaiting_approval 门禁。
- 若 UI 显示子任务未完成但 task.json `implementationProgress.counts.done === total`，优先怀疑前端缓存/映射把失败 subagent run 误当子任务状态。

# Source artifacts

- `.ypi/tasks/20260703-121653-优化-ypi-studio-subagent-chat-渲染与截断异常判断/brief.md`
- `.ypi/tasks/20260703-121653-优化-ypi-studio-subagent-chat-渲染与截断异常判断/prd.md`
- `.ypi/tasks/20260703-121653-优化-ypi-studio-subagent-chat-渲染与截断异常判断/ui.md`
- `.ypi/tasks/20260703-121653-优化-ypi-studio-subagent-chat-渲染与截断异常判断/design.md`
- `.ypi/tasks/20260703-121653-优化-ypi-studio-subagent-chat-渲染与截断异常判断/implement.md`
- `.ypi/tasks/20260703-121653-优化-ypi-studio-subagent-chat-渲染与截断异常判断/checks.md`
- `.ypi/tasks/20260703-121653-优化-ypi-studio-subagent-chat-渲染与截断异常判断/review.md`
- `.ypi/tasks/20260703-121653-优化-ypi-studio-subagent-chat-渲染与截断异常判断/summary.md`

## Source artifacts
- summary.md
- handoff.md
- review.md
- checks.md
- design.md
- implement.md
- prd.md
- brief.md
- ui.md
