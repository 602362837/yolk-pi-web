# Handoff

实现子任务 `sdk-runner-validation-docs` 已完成。

## 变更

- 新增 `lib/ypi-studio-child-session-header.ts`：抽出可测试的 Studio SDK child JSONL header 写入 helper，支持在文件不存在时创建兼容 session header，并保留已有 first-line merge 行为。
- 更新 `lib/ypi-studio-child-session-runner.ts`：运行时复用 header helper，继续在 SDK `SessionManager.create()` 后确保 child JSONL 可持久化。
- 新增 `scripts/test-ypi-studio-sdk-runner.mjs` 与 `npm run test:studio-sdk-runner`：验证缺失 child JSONL 时可创建 `studioChild` header，且 metadata parser 可识别 project/space/studioChild 字段。
- 更新 `docs/modules/library.md` / `docs/modules/api.md`：记录 SDK runner 不依赖外部 CLI、auto 优先 SDK、CLI 仅为显式回滚或 auto preflight fallback，并说明 fallback/forced-SDK 错误诊断与 usage rollup 边界。

## 验证

- `npm run test:studio-sdk-runner` — passed（Node 输出 experimental loader warning，不影响结果）。
- `npm run lint` — passed。
- `node_modules/.bin/tsc --noEmit` — passed。

## 风险/待决策

- 未执行真实模型 smoke；建议主会话按 `checks.md` 的手工 smoke 在本机配置 `studio.subagents.runner=sdk` 后验证 run/child JSONL/usage rollup。
- 当前未提交 git commit，工作区还包含本任务前两个子任务及其他任务的既有未提交改动。
