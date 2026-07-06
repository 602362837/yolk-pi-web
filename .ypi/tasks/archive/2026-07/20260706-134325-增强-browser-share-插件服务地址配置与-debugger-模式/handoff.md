# Handoff — Browser Share 服务地址配置实现进展

## 产出物

已完成设计规划文档：

- `.ypi/tasks/20260706-134325-增强-browser-share-插件服务地址配置与-debugger-模式/brief.md`
- `.ypi/tasks/20260706-134325-增强-browser-share-插件服务地址配置与-debugger-模式/prd.md`
- `.ypi/tasks/20260706-134325-增强-browser-share-插件服务地址配置与-debugger-模式/ui.md`
- `.ypi/tasks/20260706-134325-增强-browser-share-插件服务地址配置与-debugger-模式/design.md`
- `.ypi/tasks/20260706-134325-增强-browser-share-插件服务地址配置与-debugger-模式/implement.md`
- `.ypi/tasks/20260706-134325-增强-browser-share-插件服务地址配置与-debugger-模式/checks.md`

## 读取依据

- ypi web Browser Share 文档与模块文档。
- ypi web Browser Share API/manager/types/tools/control 代码。
- 外部扩展项目 `~/gitProjects/ypi-browser-share-extension` 的 README、manifest、service worker、content snapshot、popup、validate 脚本。

## 核心设计决策/建议

1. 服务地址配置放在 Chrome 扩展 popup 中；ypi web 不负责保存插件客户端地址。
2. 默认 `http://localhost:30141` 保持兼容；自定义地址通过统一 baseUrl 和保存前 health test 生效。
3. 非默认 origin 推荐 runtime optional host permission；不得默认加入 `<all_urls>` host_permissions。
4. active share 固化创建时 baseUrl，避免用户改设置后串到另一台 ypi。
5. debugger/CDP 必须显式 opt-in；推荐标准扩展无 debugger，另提供 debugger build/manifest。
6. ypi web 不直接调用 Chrome debugger；CDP 只在扩展端执行，结果通过现有 session-scoped bridge 上传。
7. CDP 首版优先增强结构化快照与坐标操作；截图默认不上传，若纳入必须单独 opt-in/审批。

## 验证情况

设计轮验证：

- 已执行读取/检索与 `git status --short` 检查。
- 已用 `python3` 解析 `implement.md` 中的 `json ypi-implementation-plan` fenced block，确认 JSON 有效且包含 8 个子任务。

实现轮（子任务 `extension-base-url-settings`）：

- 已修改外部扩展仓库 `~/gitProjects/ypi-browser-share-extension`。
- 已执行 `cd ~/gitProjects/ypi-browser-share-extension && npm run build`，通过。
- 已执行 `cd ~/gitProjects/ypi-browser-share-extension && node --check src/popup/popup.js`，通过。
- 未运行 ypi web lint/tsc：本子任务未改 ypi web 生产代码。

## 本轮实现产出（extension-base-url-settings）

- `~/gitProjects/ypi-browser-share-extension/src/popup/popup.html`：新增“蛋黄派服务地址”设置区、base URL 输入、保存并测试、重置按钮、连接状态与非本机安全提示；当前分享状态增加服务地址展示。
- `~/gitProjects/ypi-browser-share-extension/src/popup/popup.css`：新增设置面板、输入框、双按钮、安全提示和 disabled 样式。
- `~/gitProjects/ypi-browser-share-extension/src/popup/popup.js`：新增 URL 规范化（仅 http/https、去尾斜杠、保留 path prefix）、health test、`chrome.storage.local.baseUrl/lastHealth` 保存、非默认地址 runtime host permission 请求、默认地址重置和状态渲染。
- `~/gitProjects/ypi-browser-share-extension/manifest.json`：增加 `optional_host_permissions: ["http://*/*", "https://*/*"]`；默认 host permissions 仍只包含 localhost/127.0.0.1 默认端口。
- `~/gitProjects/ypi-browser-share-extension/scripts/validate.mjs`：校验 storage 权限、默认 localhost/127.0.0.1 host permission、禁止默认 `<all_urls>`/宽泛 http(s) host access，并要求 optional host permissions。
- `~/gitProjects/ypi-browser-share-extension/README.md`：补充自定义服务地址配置、permission、安全口径和 troubleshooting 片段。

## 本轮实现产出（extension-base-url-transport）

- `~/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js`：新增 service worker 侧 `normalizeBaseUrl` / `apiUrl` / settings 读取 helper；`createShare`、`refreshSnapshot`、`fetchCommands`、`postCommandResult` 全部通过统一 baseUrl 拼接 API；`activeShare.baseUrl` 继续在创建时固化，旧 active share 无 baseUrl 时安全回退当前 settings；`YPI_GET_STATE` 返回 `settings`、`baseUrl`、`activeShare`、`activeShareBaseUrl`。
- `~/gitProjects/ypi-browser-share-extension/src/popup/popup.js`：读取新的 `YPI_GET_STATE.settings` / `activeShareBaseUrl`；当 settings 与 active share 地址不一致时提示“当前分享继续连接创建时的服务地址”；保存新地址后提示只影响后续分享。

## 验证情况（extension-base-url-transport）

- 已执行 `cd ~/gitProjects/ypi-browser-share-extension && node --check src/service-worker/service-worker.js`，通过。
- 已执行 `cd ~/gitProjects/ypi-browser-share-extension && node --check src/popup/popup.js`，通过。
- 已执行 `cd ~/gitProjects/ypi-browser-share-extension && npm run build`，通过。
- 未运行 ypi web lint/tsc：本子任务未改 ypi web 生产代码。

## 主会话需确认/后续

1. `extension-base-url-transport` 已完成代码审计与统一 `apiUrl` helper；仍需在真实 Chrome 中手工验证自定义端口、LAN/HTTPS 反代 path、active share 后切换地址的端到端行为。
2. 用户已决策本轮插件基于 debugger 且纳入截图；本子任务未添加 `debugger` permission、截图 UI 或 CDP 逻辑，避免越过后续 debugger/CDP 子任务边界。
3. 需在真实 Chrome 中手工验证 optional host permission 对带端口/局域网/反代 path 的行为。当前实现按 Chrome match pattern 使用 `scheme://hostname/*` 请求权限，不包含端口。
