# 优化 Browser Share 常驻 Tab 共享与 debugger 可感知状态

- Task: 20260706-144620-优化-browser-share-常驻-tab-共享与-debugger-可感知状态
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260706-144620-优化-browser-share-常驻-tab-共享与-debugger-可感知状态
- Archived at: 2026-07-06T07:41:45.095Z
- Tags: browser-share, chrome-extension, persistent-debugger, ypi-web, feature-dev, studio

## Summary
已完成 Browser Share 常驻 Tab 共享与 debugger 可感知状态。关键可复用结论：Browser Share 扩展仍保持独立仓库 `~/gitProjects/ypi-browser-share-extension`，不并入 ypi web build；分享创建成功即常驻 attach Chrome debugger，snapshot/action 复用 debugger，不再按需 finally detach；detach 只由停止分享、ypi 解绑/替换、分享码过期、tab close、server tombstone/410、debugger 被接管等显式生命周期触发。ypi web 侧新增 lifecycle/debugger/operator/control projection、heartbeat、DELETE share stop、短 TTL tombstone；agent tools 仍只按当前 session 绑定推导 share，不能接受 shareId。debugger detached/blocked/failed/unsupported 时 action 必须 fail-safe，不可静默降级 content-script action。用户可感知状态由 Chrome debugger infobar、tab badge、extension popup 和 ypi BrowserShareControl 共同展示 baseUrl/session/permission/debugger/lifecycle。自动验证 lint、tsc、extension build 通过；真实 Chrome 手工回归仍需单独验证。

## Reusable knowledge
# Summary

已完成 Browser Share 常驻 Tab 共享与 debugger 可感知状态。实现覆盖 ypi web API/manager/types/tools/UI、Chrome 扩展 service worker/popup/badge、文档与检查。自动验证通过：`npm run lint`、`node_modules/.bin/tsc --noEmit`、`cd ~/gitProjects/ypi-browser-share-extension && npm run build`。

# Reusable knowledge

- Browser Share 扩展继续独立在 `~/gitProjects/ypi-browser-share-extension`，不要并入 ypi web Next/npm build。
- 分享创建成功即常驻 attach Chrome debugger；snapshot/action 复用同一 debugger session，不在每次操作后 detach。
- detach 只由显式生命周期触发：用户停止分享、ypi 解绑/替换、分享码过期、tab close、server tombstone/410、debugger 被外部接管等。
- ypi web 需要维护 lifecycle/debugger/operator/control projection，并通过 heartbeat、DELETE share stop、短 TTL tombstone 让扩展可感知释放 debugger。
- agent Browser Share tools 仍必须 session-scoped，从当前 session 推导绑定；不要把 `shareId` 暴露为 tool 输入。
- action 命令在 debugger detached/blocked/failed/unsupported 时必须 fail-safe，不能静默降级为 content-script action；只读 snapshot fallback 也要明确标记。
- 用户可感知状态由 Chrome debugger infobar、tab badge、extension popup、ypi `BrowserShareControl` 共同展示 baseUrl、session/operator、permission、debugger、lifecycle。
- checker 修复了 `/state` command projection：`pendingCommands` 只含 `pending_approval`，`activeCommands` 只含 `queued/running`。
- 剩余风险是浏览器级手工回归：infobar 常驻、DevTools 冲突、unbind/tombstone detach、tab close、server restart。

# Source artifacts

- `.ypi/tasks/20260706-144620-优化-browser-share-常驻-tab-共享与-debugger-可感知状态/brief.md`
- `.ypi/tasks/20260706-144620-优化-browser-share-常驻-tab-共享与-debugger-可感知状态/prd.md`
- `.ypi/tasks/20260706-144620-优化-browser-share-常驻-tab-共享与-debugger-可感知状态/ui.md`
- `.ypi/tasks/20260706-144620-优化-browser-share-常驻-tab-共享与-debugger-可感知状态/design.md`
- `.ypi/tasks/20260706-144620-优化-browser-share-常驻-tab-共享与-debugger-可感知状态/implement.md`
- `.ypi/tasks/20260706-144620-优化-browser-share-常驻-tab-共享与-debugger-可感知状态/checks.md`
- `.ypi/tasks/20260706-144620-优化-browser-share-常驻-tab-共享与-debugger-可感知状态/review.md`
- `.ypi/tasks/20260706-144620-优化-browser-share-常驻-tab-共享与-debugger-可感知状态/summary.md`

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
