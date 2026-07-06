# Summary — Browser Share 服务地址配置与 debugger 模式

## 完成内容

- Chrome 扩展 popup 支持配置 ypi web 服务地址，默认 `http://localhost:30141`，支持自定义端口、LAN、HTTPS 反代和 path prefix。
- 扩展 service worker 全链路使用配置后的 base URL；active share 固化创建时 base URL，避免设置切换后串服务。
- 扩展主 manifest 已按用户决策加入 `debugger` 权限，采用 debugger/CDP 优先模式。
- CDP 快照包含 viewport、元素 bounds、selector、AX-like role/name、debuggerRef，并支持有上限的截图数据/metadata；失败时回退 DOM snapshot。
- CDP 操作支持 click/type/scroll/navigate，并保留 content-script/tabs fallback。
- ypi web Browser Share health/types/manager/routes 兼容 captureMode、debugger、source/baseUrl、screenshot、bounds/AX/selector 等可选字段，并做服务端 sanitize。
- BrowserShareControl 与 agent tool summary 展示 capture/debugger/source/screenshot 摘要；工具参数仍不接受 shareId/tabId/baseUrl。
- 更新了 ypi web docs 与外部扩展 README。

## 验证

- `npm run lint`：通过。
- `node_modules/.bin/tsc --noEmit`：通过。
- `cd ~/gitProjects/ypi-browser-share-extension && npm run build`：通过。

## 未完成/需人工验证

- 尚未在真实 Chrome 中手工验证 debugger attach、截图、CDP 点击/输入/滚动/导航、custom baseUrl host permission、LAN/反代 path 等端到端流程。
- 未提交 git commit。当前改动横跨 ypi web 当前仓库与外部扩展仓库 `~/gitProjects/ypi-browser-share-extension`。
