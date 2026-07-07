# prd

## 目标与背景

用户反馈的核心不是 Browser Share attach 到了错误 target；现有插件已经使用 `{ tabId }`。真正目标是改善用户可感知的作用域：分享哪个 tab，就让用户能明确看出哪个 tab 正在被 YPI Browser Share 共享/可操作，同时不要误导用户以为其他 tab 也被控制。

研究结论显示，Chrome 原生 debugger infobar 是浏览器级安全警告，普通扩展无法限定为只在被 attach 的 tab 顶部显示。因此产品目标应调整为：用 Browser Share 自有 per-tab 标记弥补 Chrome 全局提示的表达缺陷，并在文档/UI 中诚实解释该限制。

## 范围内

- 确认可行性：Chrome debugger infobar 是否能限定单 tab 显示、是否能由扩展改文案/位置。
- 设计 Browser Share 自有的被分享 tab 标记：页面 overlay/badge、action badge、popup、ypi web 状态。
- 说明 persistent debugger、按需 attach、read-only non-debugger 模式的取舍。
- 更新规划文档，供后续实现员执行。

## 范围外

- 本轮不修改生产代码。
- 不尝试隐藏、伪造或绕过 Chrome 原生 debugger 安全提示。
- 不承诺让 Chrome 顶部原生提示只出现在分享 tab；该目标不可由普通扩展实现。
- 不更改 agent 工具的 session binding 安全边界。

## 需求与验收标准

### R1：可行性结论清晰

- 验收：文档明确说明 `chrome.debugger.attach({ tabId })` 的 target 是 tab，但原生 infobar 是 Chromium 全局 UI。
- 验收：文档明确说明普通 Chrome extension 不能控制 infobar 的显示 tab、位置或固定文案。

### R2：被分享 tab 必须有自有可见标记方案

- 验收：设计提供只注入/显示在 `activeShare.tabId` 的页面 badge/overlay。
- 验收：设计说明在停止分享、替换分享、tab close、detach、导航/reload 后如何移除或重注入标记。
- 验收：设计说明受限页面无法注入时的降级提示。

### R3：多表面状态一致

- 验收：popup 显示共享目标 title/url、状态、session/operator、debugger 状态，并解释 Chrome 原生警告是全局安全提示。
- 验收：browser action badge 保持 tab-specific，仅在共享 tab 上显示 `CODE`/`YPI`/`ERR`/`OFF`。
- 验收：ypi web BrowserShareControl 可选显示 target/title/url/scope 诊断，且不作为授权来源。

### R4：保留安全与能力取舍

- 验收：默认推荐仍保持 persistent debugger + per-tab overlay，以维持截图/action 可靠性。
- 验收：如提供“降低全局提示”的模式，必须明确牺牲：原生 infobar 仍无法 tab-only，只能缩短 attach 时间；截图/action/后台恢复能力会下降。

## 未决问题

1. 主会话是否接受推荐默认：**persistent debugger 保持不变 + 页面 overlay 作为 per-tab 标记**？
2. overlay 是否默认开启且不可关闭，还是允许用户在 popup 中临时隐藏？安全上建议默认开启，隐藏只影响视觉不影响共享。
3. 是否需要修改网页 title/favicon？建议默认不做，作为高级/可选项，因为会改变页面状态且容易被网站覆盖。
4. ypi web 是否也要显示 target 标记，还是先只做插件 popup + 页面 overlay？
5. 是否需要设计第二模式：read-only / on-demand debugger 以减少全局 infobar 停留时间？
