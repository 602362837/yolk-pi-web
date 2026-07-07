# summary

已修复 YPI Studio SDK runner preflight 阶段因 child session JSONL 尚未创建而写 header 失败、进而在 auto 模式回退 CLI 的问题。

## 主要变更

- 新增 `lib/ypi-studio-child-session-header.ts`，统一确保 SDK child session header 可创建/可更新。
- 更新 `lib/ypi-studio-child-session-runner.ts`，在 SDK runner 启动前确保 child JSONL header 落盘并保留 `parentSession`、`projectId`、`spaceId`、`studioChild` 元数据。
- 更新 `lib/ypi-studio-extension.ts`，持久化 SDK preflight/fallback 诊断，强制 `sdk` 模式失败时记录为真实 failed run，减少仅表现为 `runtime_lost` 的情况。
- 新增 `scripts/test-ypi-studio-sdk-runner.mjs` 与 `npm run test:studio-sdk-runner`，覆盖 header 创建、auto fallback 诊断、forced sdk 失败持久化等低成本验证。
- 更新 `docs/modules/library.md` 记录相关 helper/runner 行为。

## 验证

- `npm run test:studio-sdk-runner` — passed
- `npm run lint` — passed
- `node_modules/.bin/tsc --noEmit` — passed

## Checker 结论

Checker verdict: Pass。仅剩一个非阻塞后续关注点：SDK preflight 短窗口内取消 async run 时，临时 runtime handle 的 abort 目前是 no-op，存在窄取消竞态；不影响本任务验收。
