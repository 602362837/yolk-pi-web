# ui

## 是否需要 UI 设计员

建议需要轻量 UI 设计员参与，重点不是重新设计 Browser Share 面板，而是定义“被分享 tab 自有标记”的视觉、文案和交互边界。Chrome 原生 debugger infobar 不能变成单 tab 标记，所以页面 overlay/badge 将成为主要可感知信号。

## 页面 / 组件 / 状态

### 1. 分享 tab 页面 overlay（推荐主方案）

- 位置：页面右上角或左下角固定悬浮，避开常见导航栏；使用 Shadow DOM + 高 z-index，尽量不受页面 CSS 影响。
- 文案：
  - 未绑定：`YPI sharing code active` / `等待绑定到 ypi`
  - 已绑定：`Shared with YPI` / `已分享给 ypi session …`
  - 可操作模式：显示 `readonly` 或 `interactive`
  - Debugger 异常：`YPI debugger disconnected`
- 交互：默认低干扰，建议 `pointer-events: none`；如需要停止按钮，应谨慎评估，避免覆盖页面点击。
- 视觉：小尺寸、黄色/绿色状态点、半透明深色背景；必须明显，但不能伪装成 Chrome 原生 UI。
- 生命周期：仅在 `activeShare.tabId` 注入；停止/替换/关闭/解绑时移除；导航/reload 后重注入。

### 2. Browser action badge（已有，需强化文案）

- 已有 per-tab `chrome.action.setBadgeText({ tabId })`：`CODE`、`YPI`、`ERR`、`OFF`。
- 强化 tooltip/title：明确“只标记这个共享 tab；Chrome 顶部 debugger 警告是全局安全提示”。
- 局限：扩展未固定到工具栏时不够显眼，不能替代页面 overlay。

### 3. Popup active share 区域

- 增加 “共享目标” 区块：title、url、tabId/windowId（可折叠诊断）。
- 增加说明：`Chrome 顶部 debugger 提示由 Chrome 全局显示；Browser Share 实际 target 是此 tab，页面内 YPI 标记才是共享 tab 标记。`
- 显示 overlay 状态：`已注入 / 注入失败 / 页面受限，仅使用 toolbar badge 标记`。

### 4. ypi web BrowserShareControl（可选）

- 显示共享 tab title/url、debugger state、target scope = `tab`。
- 显示一句说明：`Chrome debugger warning may be global; Browser Share commands target the shared tab only.`

### 5. favicon/title 标记（可选，不推荐默认）

- 可在标题前加 `● YPI ·` 或替换 favicon 为带角标版本。
- 风险：修改页面状态，可能影响用户复制标题、网站逻辑或被 SPA 覆盖；建议只作为 opt-in 或实验项。

## 需要原型化的问题

1. Overlay 位置和尺寸是否会遮挡常见网页操作？
2. 是否需要用户可临时隐藏 overlay？若允许隐藏，如何保证仍有足够可见安全信号？
3. 中英文文案是否同时显示，还是随扩展语言走？
4. 受限页面无法注入时，popup/action badge 的 fallback 是否足够醒目？
