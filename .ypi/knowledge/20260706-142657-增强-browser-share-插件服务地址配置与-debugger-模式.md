# 增强 Browser Share 插件服务地址配置与 debugger 模式

- Task: 20260706-134325-增强-browser-share-插件服务地址配置与-debugger-模式
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260706-134325-增强-browser-share-插件服务地址配置与-debugger-模式
- Archived at: 2026-07-06T06:26:57.681Z
- Tags: browser-share, chrome-extension, debugger, cdp, ypi-web, studio, feature-dev

## Summary
已完成 Browser Share 插件服务地址配置与 debugger-first/CDP 能力。关键结论：扩展端应在 popup 保存并测试 ypi web baseUrl，默认保持 http://localhost:30141，支持自定义端口、LAN、HTTPS 反代和 path prefix；所有 extension transport 必须通过统一 apiUrl/baseUrl helper，activeShare 固化创建时 baseUrl，避免设置切换后串服务。用户本轮决策为单一 debugger-first manifest 并纳入截图，安全额外加固 deferred。CDP 能力只在扩展 service worker 内执行，ypi web 不直接接 Chrome debugger；上报内容必须是白名单摘要，如 captureMode、viewport、bounds、selector、AX-like role/name、debugger/source/screenshot metadata，并由 BrowserShareManager 服务端 sanitize。CDP click/type/scroll/navigate 需保留 content-script/tabs fallback，且不改变 ypi web readonly/interactive 审批矩阵。Agent tools 仍禁止 shareId/tabId/baseUrl 参数，只从当前 session binding 推导。验证通过 npm run lint、tsc --noEmit、extension npm run build；真实 Chrome custom baseUrl、attach 冲突、fallback、截图端到端仍需人工验证。

## Reusable knowledge
# Summary

完成 Browser Share 扩展服务地址配置与 debugger-first/CDP 增强。扩展 popup 可配置 ypi web baseUrl，默认 `http://localhost:30141`，支持自定义端口、LAN、HTTPS 反代和 path prefix；service worker 全链路使用统一 baseUrl，并让 active share 固化创建时地址。扩展采用单一 debugger-first manifest，加入 CDP 快照、受限截图、CDP click/type/scroll/navigate 和 fallback。ypi web 兼容并 sanitize capture/debugger/source/screenshot/bounds/AX/selector 等字段，UI 与 tool summary 展示摘要；tools 仍不接受 `shareId`、`tabId`、`baseUrl`。

# Reusable knowledge

- 服务地址配置应属于 Chrome 扩展客户端，而不是 ypi web；保存前做 URL 规范化与 `/api/browser-share/health` 测试。
- 所有扩展 bridge fetch 必须走统一 `apiUrl(path, baseUrl?)`；share 创建后 `activeShare.baseUrl` 固化，后续 snapshot、commands、result 都用该地址，防止切换设置后串服务。
- CDP/debugger 能力只应在扩展 service worker 内封装；ypi web 通过既有 session-scoped bridge 接收受限摘要，不直接连接 Chrome debugger。
- CDP 上报字段需白名单化并服务端裁剪：`captureMode`、viewport、bounds、selector、AX-like role/name、debugger/source/screenshot metadata；不要存 raw DOM/AX/cookies/localStorage/表单值。
- CDP 操作必须保留 content-script/tabs fallback，并保持 readonly/interactive 审批矩阵不变。
- Agent Browser Share tools 不得新增 `shareId`/`tabId`/`baseUrl` 参数，只能从当前 session binding 推导。
- 自动验证通过不等于真实浏览器验证完成；custom baseUrl/LAN/反代 path、debugger attach 冲突、CDP fallback、截图端到端仍需人工 Chrome 矩阵验证。

# Source artifacts

- `.ypi/tasks/20260706-134325-增强-browser-share-插件服务地址配置与-debugger-模式/brief.md`
- `.ypi/tasks/20260706-134325-增强-browser-share-插件服务地址配置与-debugger-模式/prd.md`
- `.ypi/tasks/20260706-134325-增强-browser-share-插件服务地址配置与-debugger-模式/ui.md`
- `.ypi/tasks/20260706-134325-增强-browser-share-插件服务地址配置与-debugger-模式/design.md`
- `.ypi/tasks/20260706-134325-增强-browser-share-插件服务地址配置与-debugger-模式/implement.md`
- `.ypi/tasks/20260706-134325-增强-browser-share-插件服务地址配置与-debugger-模式/checks.md`
- `.ypi/tasks/20260706-134325-增强-browser-share-插件服务地址配置与-debugger-模式/handoff.md`
- `.ypi/tasks/20260706-134325-增强-browser-share-插件服务地址配置与-debugger-模式/review.md`
- `.ypi/tasks/20260706-134325-增强-browser-share-插件服务地址配置与-debugger-模式/summary.md`

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
