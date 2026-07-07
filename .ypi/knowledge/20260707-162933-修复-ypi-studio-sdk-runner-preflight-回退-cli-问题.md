# 修复 YPI Studio SDK runner preflight 回退 CLI 问题

- Task: 20260707-160855-修复-ypi-studio-sdk-runner-preflight-回退-cli-问题
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260707-160855-修复-ypi-studio-sdk-runner-preflight-回退-cli-问题
- Archived at: 2026-07-07T08:29:33.030Z
- Tags: ypi-studio, sdk-runner, child-session, fallback, diagnostics, studio, feature-dev

## Summary
已完成并归档：修复 YPI Studio SDK runner preflight 回退 CLI 问题。关键可复用结论：SessionManager.create() 可能只分配 child session id/file path 而不立即落盘 JSONL，SDK runner 在 prompt 前写 header 不能假设文件已存在；应使用 ensure helper 在缺失时创建兼容 session header，并保留 parentSession、projectId、spaceId、studioChild 元数据。auto runner 模式中 SDK preflight 失败只应在 prompt 发送前回退 CLI，且 preflight/fallback 诊断必须持久化到 run warnings/summary/transcript，避免被 CLI final snapshot 覆盖。强制 runner=sdk 的 async preflight 失败应落成真实 failed run 与 failed transcript，而不是在 poll/collect 中退化为 runtime_lost。新增低成本验证脚本 test:studio-sdk-runner 覆盖 header 创建、fallback 诊断和 forced sdk 失败持久化；常规验证为 lint 与 tsc。后续可关注 SDK preflight 短窗口取消 async run 的窄竞态。

## Reusable knowledge
# Summary

修复了 YPI Studio SDK runner 在 preflight 阶段因 child session JSONL 尚未创建而写 header 抛 `ENOENT`，导致 `auto` 模式错误回退 CLI 的问题；同时增强了 SDK preflight/fallback 与强制 `sdk` 模式失败的诊断持久化。

# Reusable knowledge

- `SessionManager.create()` 可能只分配 child session id/file path，不保证 JSONL 已落盘；SDK child runner 在 prompt 前写 header 时不能直接 `readFileSync(childSessionFile)`。
- 对 Studio SDK child session，应通过专用 ensure helper 在文件不存在时创建兼容 session header；文件已存在时再合并/更新 header。header 必须保留 `parentSession`、`projectId`、`spaceId`、`studioChild`，以便 session-reader 识别和过滤 Studio child session。
- `studio.subagents.runner=auto` 的 SDK preflight 失败只应在 prompt 发送前回退 CLI；fallback 的 SDK 错误要保留到 run warnings/summary/transcript，不能被 CLI progress/final snapshot 覆盖。
- 强制 `runner=sdk` 的 async preflight/prompt 前失败必须持久化为真实 `failed` run 与 failed transcript，避免 poll/collect 只显示 `runtime_lost`。
- 可用低成本脚本 `npm run test:studio-sdk-runner` 覆盖 header 创建、auto fallback 诊断、forced sdk 失败持久化；配合 `npm run lint` 与 `node_modules/.bin/tsc --noEmit` 作为验收。
- 非阻塞后续关注：SDK preflight 极短窗口内取消 async run 时，临时 runtime handle 的 abort 目前可能是 no-op，存在窄取消竞态。

# Source artifacts

- `.ypi/tasks/20260707-160855-修复-ypi-studio-sdk-runner-preflight-回退-cli-问题/summary.md`
- `.ypi/tasks/20260707-160855-修复-ypi-studio-sdk-runner-preflight-回退-cli-问题/design.md`
- `.ypi/tasks/20260707-160855-修复-ypi-studio-sdk-runner-preflight-回退-cli-问题/implement.md`
- `.ypi/tasks/20260707-160855-修复-ypi-studio-sdk-runner-preflight-回退-cli-问题/review.md`
- Code/docs touched: `lib/ypi-studio-child-session-header.ts`, `lib/ypi-studio-child-session-runner.ts`, `lib/ypi-studio-extension.ts`, `scripts/test-ypi-studio-sdk-runner.mjs`, `package.json`, `docs/modules/library.md`

## Source artifacts
- summary.md
- handoff.md
- review.md
- checks.md
- design.md
- implement.md
- prd.md
- brief.md
