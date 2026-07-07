# 设计 YPI Studio subagent in-process SDK 子会话一致性改造

- Task: 20260707-121400-设计-ypi-studio-subagent-in-process-sdk-子会话一致性改造
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260707-121400-设计-ypi-studio-subagent-in-process-sdk-子会话一致性改造
- Archived at: 2026-07-07T05:47:17.739Z
- Tags: feature-dev, ypi-studio, subagent, sdk-runner, child-session, archive, studio

## Summary
已完成并归档：YPI Studio subagent in-process SDK 子会话一致性改造。关键可复用结论：Studio subagent 应采用一个 run 一个持久 child JSONL session，task.json 仍是 workflow/run 状态权威；child header 写入 studioChild 并继承父 session projectId/spaceId，run/transcript/API 投影填充 runner、childSessionId、childSessionFile、requestAffinity。runner 配置使用 studio.subagents.runner=auto|sdk|cli：auto 默认优先 SDK，只有 SDK preflight 在 prompt 发送前失败才回退 CLI；sdk 强制失败不回退；cli 是旧路径回滚。SDK child 必须不注入 Studio orchestration tools，并通过 createYpiStudioChildGuardExtension + excludeTools 阻断 ypi_studio_task/subagent/wait、subagent/trellis_subagent、Browser Share action tools，以及 best-effort 阻断 .ypi/tasks/**/task.json 写入，避免递归编排和 approval gate 绕过。Session/API/Sidebar/Chat 对 Studio child 默认隐藏普通历史，只在父 session 下折叠展示，打开后作为只读审计视图。验证需覆盖 lint、tsc、studio-policy、studio-dag；真实 provider E2E smoke（SDK child header、wait/cancel、Sidebar 审计链路）作为生产前建议。

## Reusable knowledge
# Summary

已完成 YPI Studio subagent in-process SDK 子会话一致性改造：将 Studio 子代理从 CLI-only spawn 迁移为可配置的 in-process SDK child runner，并保留 CLI fallback/rollback。实现包含持久 child JSONL、`studioChild` header、run/transcript/API metadata、递归工具隔离、approval gate 防护、Session/Sidebar/Chat 只读审计路径，以及配置与文档更新。最终 checker 复查结论为 Pass；自动验证通过。

# Reusable knowledge

- Studio subagent 长期应采用“一个 run 一个持久 child session”：child JSONL 负责审计、真实对话、工具调用与 provider affinity；`.ypi/tasks/<task>/task.json` 仍是 workflow/run 状态权威。
- child session header 写 `studioChild`，并继承父 session 的 `projectId/spaceId`；run/transcript/API 投影应填充 `runner`、`childSessionId`、`childSessionFile`、`requestAffinity`。
- `studio.subagents.runner` 支持 `auto | sdk | cli`：`auto` 默认优先 SDK，只在 SDK preflight 且 prompt 未发送前失败时回退 CLI；`sdk` 显式模式应失败而不静默回退；`cli` 用于旧 runner 回滚。
- SDK child profile 必须隔离递归编排能力：不注入 Studio orchestration tools，并用 `createYpiStudioChildGuardExtension` / `excludeTools` 阻断 `ypi_studio_task`、`ypi_studio_subagent`、`ypi_studio_wait`、`subagent`、`trellis_subagent`、Browser Share action tools，以及 best-effort 阻断 `.ypi/tasks/**/task.json` 直接写入，避免绕过 approval gate。
- Session 列表和项目空间默认不把 Studio child 当普通 root 历史；UI 应在父 session 下折叠显示 child audit rows。打开 child session 时 Chat 只读，并明确提示“回到父 Chat 继续编排”。
- SDK event mapper 应保持 CLI runner 既有 progress/transcript/runtime 语义：phase、tokens/tps、currentTool、itemsPreview、warnings、display/truncation、terminationReason 等字段继续可用于 UI 和 wait/poll/collect/cancel。
- 验收至少运行 `npm run lint`、`node_modules/.bin/tsc --noEmit`、`npm run test:studio-policy`、`npm run test:studio-dag`；生产前建议再做真实 provider E2E smoke：启动 SDK child、检查 child JSONL header、wait/cancel 与 Sidebar 审计链路。

# Source artifacts

- `.ypi/tasks/20260707-121400-设计-ypi-studio-subagent-in-process-sdk-子会话一致性改造/summary.md`
- `.ypi/tasks/20260707-121400-设计-ypi-studio-subagent-in-process-sdk-子会话一致性改造/review.md`
- `.ypi/tasks/20260707-121400-设计-ypi-studio-subagent-in-process-sdk-子会话一致性改造/handoff.md`
- `.ypi/tasks/20260707-121400-设计-ypi-studio-subagent-in-process-sdk-子会话一致性改造/design.md`
- `.ypi/tasks/20260707-121400-设计-ypi-studio-subagent-in-process-sdk-子会话一致性改造/implement.md`
- `.ypi/tasks/20260707-121400-设计-ypi-studio-subagent-in-process-sdk-子会话一致性改造/checks.md`

## Source artifacts
- summary.md
- handoff.md
- review.md
- checks.md
- design.md
- implement.md
- brief.md
- ui.md
