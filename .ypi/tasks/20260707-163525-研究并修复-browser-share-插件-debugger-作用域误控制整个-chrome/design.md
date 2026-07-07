# design

## 方案摘要

修正后的判断：Browser Share 的 debugger target 选择本身没有发现错误，仍是 tab-scoped；但 Chrome 原生 debugger infobar 不是 tab-scoped UI。Chromium 在扩展调用 `chrome.debugger.attach` 后创建全局 infobar，显示在每个 tab / browser window 上，且文案固定为“`<extension>` started debugging this browser”。普通 Chrome extension 不能把它改成“只在被分享 tab 顶部显示”。

因此本任务不应继续以“修复 infobar scope”为目标，而应改为：

1. 继续保证 CDP target 只使用共享 tab；
2. 把 Chrome 原生 infobar 定义为不可控的浏览器级安全警告；
3. 在共享 tab 内增加 Browser Share 自有可见标记（overlay/badge），并在 popup/web/action badge 中同步目标信息；
4. 若要减少全局警告停留时间，单独提供按需 attach 或 read-only non-debugger 模式作为产品取舍，而不是承诺 tab-only infobar。

## 关键证据

### Browser Share 当前 target 仍是 tab

- `/Users/zyj/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js`
  - `debuggerTarget(tabId)` 返回 `{ tabId }`。
  - `ensureDebuggerAttached(tabId)` 调用 `chrome.debugger.attach({ tabId }, "1.3")`。
  - `debuggerSend(tabId, ...)` / `releaseDebugger(tabId, ...)` 同样使用 `{ tabId }`。
  - `createShare()` 只在创建时通过 `chrome.tabs.query({ active: true, currentWindow: true })` 选一次 tab，并保存 `activeShare.tabId`。
  - snapshot/action/poll/stop/onDetach/onRemoved 都围绕 `activeShare.tabId`。
- ypi web 侧不调用 `chrome.debugger`，只处理 share/session 绑定、快照、命令队列和状态上报。

### Chrome 原生 debugger infobar 是全局 UI

- Chrome extension debugger API 文档：`Debuggee.tabId` 可用于 target tabs；这只约束调试目标，不约束 Chrome UI 提示位置。
- Chromium `chrome/browser/extensions/api/debugger/debugger_api.cc`：扩展 attach 后调用 `ExtensionDevToolsClientHost::CreateWarningInfobar()`。
- Chromium `chrome/browser/extensions/api/debugger/extension_dev_tools_infobar_delegate.h`：该类注释为“globally warn users that an extension is debugging the browser”。
- Chromium `chrome/browser/devtools/global_confirm_info_bar.h`：`GlobalConfirmInfoBar is shown for every tab in every browser until it is dismissed or the close method is called.`
- Chromium `chrome/browser/extensions/api/debugger/debugger_apitest.cc`：测试明确写到 “Attaching to one tab should create infobars in both browsers.” 并断言多个 tab/browser 的 infobar 都出现。
- Chromium `chrome/app/generated_resources.grd`：`IDS_DEV_TOOLS_INFOBAR_LABEL` 文案是 `"<extension>" started debugging this browser`。

结论：即使 `attach({ tabId: A })`，Chrome 也会显示全局安全提示；这不是 Browser Share target 错误。

## 可行性判断

| 诉求 | 可行性 | 说明 |
| --- | --- | --- |
| 只 attach 被分享 tab | 可行，且当前基本已做到 | 仍可加 wrapper guard 防回归。 |
| 让 Chrome 原生 debugger infobar 只出现在被分享 tab | 不可行 | Chromium 使用 `GlobalConfirmInfoBar`。 |
| 修改 Chrome 原生 infobar 文案为“this tab” | 不可行 | 文案由 Chromium 资源固定，扩展无 API。 |
| 隐藏/抑制原生 infobar | 普通扩展不可行/不应做 | 命令行开关或 policy 安装不是普通产品方案，也绕过安全提示。 |
| 在共享 tab 上显示自有标记 | 可行 | 页面 overlay、action badge、popup/web 状态。 |
| 缩短全局 infobar 出现时间 | 部分可行 | 改成按需 attach/detach，但每次 attach 仍触发全局提示，并牺牲能力。 |

## 推荐设计：自有 per-tab 标记

### 1. 页面 overlay / badge（主标记）

在 `activeShare.tabId` 的页面内容区注入轻量 overlay：

- 只对共享 tab 注入，其他 tab 不注入。
- 展示共享状态、permission mode、绑定 session 短 ID、debugger 状态。
- 停止/替换/关闭/解绑时移除。
- 导航/reload 后重注入；如果是 `navigate` 命令触发，命令完成后刷新 snapshot 并重新注入。
- 受限页面（`chrome://`、Chrome Web Store、部分 PDF/特殊页面等）无法注入时，降级为 action badge + popup/web 提示。

实现策略留给实现阶段确认：

- 可先用 `chrome.scripting.executeScript` 注入 overlay，复用现有 `activeTab/scripting` 权限路径。
- 对跨 origin 导航后 activeTab 权限可能失效的情况，可考虑在 persistent debugger 已附加时用 CDP `Runtime.evaluate` / `Page.addScriptToEvaluateOnNewDocument` 做 best-effort 注入；但这会继续依赖 debugger。
- overlay 使用 Shadow DOM、固定 ID、幂等 update/remove，避免重复注入和页面 CSS 污染。

### 2. Browser action badge（辅助标记）

现有代码已使用 `chrome.action.setBadgeText({ tabId })`，这是真正 tab-specific 的 Chrome extension UI 能力。建议保留并强化：

- `CODE`：分享码待绑定；
- `YPI`：已绑定；
- `ERR`：debugger/传输异常；
- `OFF`：ypi 服务离线。

局限：badge 在扩展 action 图标上，不在 tab strip 或页面顶部；如果用户没有 pin 扩展，可见性有限。

### 3. Popup / ypi web 状态

- Popup active share 区域展示 target title/url、tabId/windowId（诊断）、overlay 状态和 operator/session。
- ypi web `BrowserShareControl` 可选展示同样 target summary。
- 文案明确：Chrome 顶部 debugger 警告是 Chrome 全局安全提示；Browser Share 实际只操作共享 tab。

### 4. favicon/title 标记（可选，不推荐默认）

- 可把 document title 前缀改为 `● YPI ·` 或临时替换 favicon 为带角标版本。
- 不推荐默认开启：会改变页面状态，容易被 SPA 覆盖，可能影响用户对网页自身标题/图标的判断。

## Persistent debugger 与替代模式取舍

### 方案 A：保持 persistent debugger + overlay（推荐默认）

优点：

- 保留当前截图和 action 可靠性。
- 后台命令轮询和 MV3 唤醒后恢复逻辑最少变化。
- overlay 给用户 per-tab 可见信号。

缺点：

- Chrome 原生全局 infobar 仍会持续存在；只能解释，不能变成单 tab。

### 方案 B：按需 attach/detach debugger

优点：

- 全局 infobar 只在 snapshot/action 期间或短时间内出现，用户感知更弱。

缺点：

- 每次 attach 仍是全局 infobar，不能满足“只在分享 tab 显示”。
- 命令延迟和失败率上升；DevTools/其他 debugger 竞争更频繁。
- 失去“分享期间持续可见”的 Chrome 原生安全信号。
- 需要重新设计 action tool 的 debugger health、pending approval 和超时语义。

### 方案 C：read-only non-debugger 模式

优点：

- 不 attach debugger 时没有 Chrome debugger infobar。
- 可用 content script 收集有限页面快照并显示 overlay。

缺点：

- 没有 CDP 截图/可靠 bounds/action；当前 Browser Share action 工具不应在缺少 debugger 时静默执行。
- 跨 origin 导航和受限页面能力下降。
- 需要新增产品模式和清晰能力降级 UI。

## 影响模块和边界

### 插件仓库（后续实现）

- `/Users/zyj/gitProjects/ypi-browser-share-extension/src/service-worker/service-worker.js`
  - 保留或轻量加固 share-scoped debugger wrapper，但目标是防回归，不是改变 infobar。
  - 新增 overlay lifecycle helper：inject/update/remove/reinject-on-navigation。
  - activeShare 增加 `windowId`、`targetTitleAtShare`、`targetUrlAtShare`、`marker` / `overlay` 状态。
  - heartbeat/snapshot 可上报 marker 状态。
- `/Users/zyj/gitProjects/ypi-browser-share-extension/src/popup/*`
  - 展示共享目标、overlay 状态、全局 infobar 说明。
- `/Users/zyj/gitProjects/ypi-browser-share-extension/README.md`、`INSTALL.md`
  - 故障排查更新：Chrome 原生提示是全局的，页面内 YPI 标记才是共享 tab 标记。

### ypi web 仓库（可选）

- `lib/browser-share-types.ts` / `lib/browser-share-manager.ts`
  - 增加可选 sanitized target/marker metadata。
- `components/BrowserShareControl.tsx`
  - 展示 target summary 和 marker/debugger 状态。
- `docs/architecture/browser-share.md`
  - 将 Chrome infobar 从“per-tab safety signal”改为“global Chrome debugger warning”；新增 Browser Share overlay 作为 per-tab signal。

## 数据流 / 文件契约

```text
popup share click
  -> activeTab() selects tab A once
  -> activeShare = { shareId, tabId: A, windowId, targetTitleAtShare, targetUrlAtShare }
  -> chrome.debugger.attach({ tabId: A })
       -> Chrome shows global debugger warning (not controllable)
  -> Browser Share injects/updates overlay only in tab A
  -> action badge set only for tab A
  -> heartbeat reports target/debugger/marker status
  -> stop/rebind/expire/tab close removes overlay, clears badge, detaches debugger
```

新增字段必须 optional，保证旧插件/旧 ypi web 互通。

## 风险与缓解

- **用户仍不接受全局 Chrome infobar**：需要主会话决定是否引入按需 attach/read-only 模式；overlay 无法改变 Chrome UI。
- **overlay 遮挡页面**：小尺寸、可折叠/低干扰、Shadow DOM、明确 z-index；必要时允许临时隐藏但保留 popup/action badge。
- **overlay 注入失败**：受限页面降级为 action badge/popup/web 状态，不阻塞 stop/detach。
- **activeTab 权限与跨 origin 导航**：优先用当前权限；必要时利用已附加 debugger 做 best-effort 注入；失败时报告 marker 状态。
- **title/favicon 修改副作用**：默认不启用，只作为可选增强。
- **把 overlay 误解成授权边界**：授权仍以 share/session binding 为准，overlay 只是可见标记。

## 回滚

- Overlay/marker 改动应独立开关；回滚时保留现有 persistent debugger、action badge 和 popup 状态。
- Web target/marker metadata 为 additive optional，回滚 UI 展示不影响 bridge 命令。
