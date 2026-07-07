# brief

## 目标

重新研究并修正 Browser Share Chrome 插件的设计方向：用户认可当前 `chrome.debugger` target 已是 tab-scoped，真正诉求不是修复 target 误选，而是希望“分享哪个 tab，哪个 tab 才出现 Chrome 顶部 debugger 提示”，并且在被分享 tab 上有明确标记。

## 结论摘要

1. **Chrome debugger attach target 可以是 tab，但 Chrome 顶部 debugger infobar 是浏览器级 / 全局提示 UI。**
   - Browser Share 现有代码只 attach `{ tabId }`，目标 tab 本身没有发现误控全 Chrome。
   - Chromium 实现把扩展 debugger 警告放进 `GlobalConfirmInfoBar`；它会在每个 tab / 每个 browser window 显示，而不是只显示在被 attach 的 tab。
2. **Chrome extension 不能控制该 infobar 的显示位置、作用范围或文案。**
   - 文案由 Chromium 资源 `IDS_DEV_TOOLS_INFOBAR_LABEL` 固定生成：`"<extension>" started debugging this browser`。
   - 普通扩展没有 API 可以把它改成“this tab”、只放在目标 tab、或自定义关闭策略。`--silent-debugger-extension-api` / policy-installed extension 不是面向普通用户安装的产品方案。
3. 因此，**“让 Chrome 原生 debugger 提示只在分享 tab 顶部出现”不可实现**；可以实现的是：
   - 保持 debugger target tab-scoped；
   - 不再把 Chrome 原生 infobar 当作 per-tab 标记；
   - 在被分享 tab 内注入 Browser Share 自有可见 badge/overlay，并配合 action badge、popup、ypi web 状态展示；
   - 若用户更在意减少全局提示，可考虑按需 attach / read-only non-debugger 模式，但会牺牲截图、动作可靠性和持续可见安全信号。

## 已读证据

- ypi web 文档：`docs/architecture/browser-share.md`
- 插件代码：
  - `/Users/zyj/gitProjects/ypi-browser-share-extension/manifest.json`
  - `/Users/zyj/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js`
  - `/Users/zyj/gitProjects/ypi-browser-share-extension/src/popup/popup.{html,js,css}`
  - `/Users/zyj/gitProjects/ypi-browser-share-extension/scripts/validate.mjs`
- Chrome/Chromium 证据：
  - Chrome extension debugger API 文档说明 `Debuggee.tabId` 可用于 target tabs。
  - `chrome/browser/extensions/api/debugger/debugger_api.cc`：扩展 attach 后调用 `ExtensionDevToolsClientHost::CreateWarningInfobar()`。
  - `chrome/browser/extensions/api/debugger/extension_dev_tools_infobar_delegate.{h,cc}`：该 infobar 是“globally warn users that an extension is debugging the browser”；文案由 `IDS_DEV_TOOLS_INFOBAR_LABEL` 生成。
  - `chrome/browser/devtools/global_confirm_info_bar.h`：`GlobalConfirmInfoBar is shown for every tab in every browser until it is dismissed or the close method is called.`
  - `chrome/browser/extensions/api/debugger/debugger_apitest.cc`：测试明确写到 “Attaching to one tab should create infobars in both browsers.” 并断言多个 tab/browser 的 infobar manager 都出现警告。

## 当前插件现状

- `service-worker.js` 中 `debuggerTarget(tabId)` 返回 `{ tabId }`，`attach/sendCommand/detach` 均基于 tabId。
- 创建分享时 `activeTab()` 只读取一次 `chrome.tabs.query({ active: true, currentWindow: true })`，后续使用 `activeShare.tabId`。
- 已有 `chrome.action.setBadgeText({ tabId: share.tabId, ... })` 的 per-tab action badge，但它显示在扩展 action 图标上，不是在网页内容区或 Chrome tab strip 上；如果扩展未固定到工具栏，用户可见性有限。

## 推荐方向

推荐把方案从“infobar 作用域硬化”改为“原生 infobar 可行性澄清 + 自有 per-tab 标记”：

1. 文档/UI 诚实说明：Chrome 原生 debugger infobar 是全局警告，不代表 Browser Share 控制所有 tab。
2. 在分享 tab 内容区注入明显但低干扰的 YPI badge/overlay，作为真正的 per-tab 标记。
3. 强化 action badge、popup、ypi web BrowserShareControl 的 target/title/url/session 诊断。
4. 保留原先 tab-scoped debugger guard 作为代码健康加固，但不要把它包装成能改变 Chrome infobar 显示范围的修复。
5. 如主会话希望减少全局 infobar，再单独评估“按需 attach”或“read-only non-debugger”模式的产品取舍。
