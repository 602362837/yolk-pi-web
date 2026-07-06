# handoff

## 产出

已完成 Browser Share 常驻 tab 共享 / debugger 可感知状态设计，覆盖：

- PRD：`prd.md`
- UI 文案与状态：`ui.md`
- 生命周期、debugger attach/detach、API/字段、兼容失败处理：`design.md`
- 实施拆解：`implement.md`
- 检查与验收：`checks.md`
- 任务简报：`brief.md`

未修改生产代码，未提交。

## 核心设计结论

- 创建分享成功后立即常驻 attach Chrome debugger；snapshot/action 复用该连接，不再 finally detach。
- detach 只发生在停止分享、ypi 解绑/替换、分享码过期、tab 关闭、扩展/浏览器清理或 debugger 被外部接管等明确事件。
- 用户可见性由 Chrome debugger infobar、tab badge、popup “可操作对象”卡片、ypi `BrowserShareControl` 授权范围共同保证。
- action command 在 debugger 不可用时 fail-safe；不做静默 content-script 操作降级。
- ypi web 需要新增 lifecycle/debugger/operator 投影、heartbeat/stop API、share tombstone，确保 ypi 解绑后 extension 能释放 debugger。

## 验证

未运行 lint/type-check/build；本轮仅写入规划文档。

## 剩余风险

- Chrome debugger 与 DevTools/其他扩展冲突时，需要产品接受“阻止分享/命令失败”的严格策略。
- MV3 service worker suspend 仍会导致心跳 stale，需要通过 alarm/startup 恢复和 UI 状态表达缓解。
- BrowserShareManager 仍是内存态，ypi web 重启后 active share 应要求重新分享。

## 需要主会话决策

1. 是否接受 MVP 不提供“debugger attach 失败但只读 DOM 分享”的降级模式？推荐接受。
2. 是否暂不做页面内持久 overlay，仅使用 Chrome infobar + badge + popup + ypi UI？推荐暂不做。
3. popup 是否只展示 session shortId/baseUrl，暂不接入 session title lookup？推荐只展示 shortId。
