# Brief — 增强 Browser Share 插件服务地址配置与 debugger 模式

## 背景

用户反馈 YPI Browser Share Chrome 插件当前看起来固定连接 `http://localhost:30141/`，不适合以下场景：

- ypi web 使用自定义端口运行。
- 浏览器与 ypi web 不在同一台机器，需要通过局域网地址访问。
- ypi web 通过反向代理或 HTTPS 域名访问。
- 希望获得类似 OpenClaw 的 Chrome debugger/CDP 细节能力，例如更稳定的元素定位、布局/坐标、可访问性树、截图等。

本设计基于已读材料：

- ypi web Browser Share 文档：`docs/architecture/browser-share.md`、`docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`。
- ypi web Browser Share 代码：`app/api/browser-share/**`、`lib/browser-share-types.ts`、`lib/browser-share-manager.ts`、`lib/browser-share-extension.ts`、`components/BrowserShareControl.tsx`。
- 外部插件项目：`~/gitProjects/ypi-browser-share-extension/README.md`、`manifest.json`、`src/service-worker/service-worker.js`、`src/content/snapshot.js`、`src/popup/popup.*`、`scripts/validate.mjs`。

## 当前状态

- 插件默认 `DEFAULT_BASE_URL = "http://localhost:30141"`，popup 只做健康检查、生成分享码、刷新快照、停止分享。
- 插件 manifest 当前只允许本机默认地址 host permissions；没有 `debugger` 权限。
- ypi web 的 Browser Share API 与 agent tools 已基于 share code + session binding，工具不接受任意 `shareId`。
- 当前架构文档明确记录 debugger/CDP 曾被 deferred；本任务需要重新设计可选支持方案，而不是让 ypi web 直接调用 Chrome debugger。

## 设计目标

1. 插件分享页面允许配置 ypi web 服务地址，默认仍为 `http://localhost:30141`。
2. 支持自定义端口、局域网地址、HTTPS 反代、可选反代子路径。
3. 连接地址配置不破坏现有本机默认用法。
4. debugger/CDP 能力必须显式 opt-in，不应静默扩大权限或数据面。
5. debugger/CDP 只能由扩展端执行；ypi web 继续通过现有命令/结果通道接收受限、脱敏、长度受控的数据。
6. 保持多 session 防误分享边界：share code 仍由用户粘贴到目标 chat/session 绑定，agent tools 仍只使用当前 session 上下文。

## 主要风险

- 自定义服务地址会突破“localhost only”的原始安全假设；ypi web 本身若暴露到公网需要独立应用级鉴权，本任务不应给出虚假的 Browser Share 局部安全承诺。
- Chrome `debugger` 权限风险高，可能触发用户可见提示、与 DevTools/其他调试器冲突，并扩大可采集数据范围。
- CDP 截图可能包含敏感可见信息，不能默认上传给 agent。
- Chrome MV3 service worker 生命周期仍可能导致命令/调试 attach 延迟；需要 fallback 与清晰状态提示。
