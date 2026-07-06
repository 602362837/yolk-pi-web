# PRD — 优化 Browser Share New Chat 绑定与 Chat 直接操作 Tab 交互

## 本轮确认与重新评估结论

已纳入用户反馈：

1. **接受 New Chat 绑定时懒创建真实空 session**，但该 session 在用户发出第一句话后必须刷新显示标题，不能长期停留在 Untitled / 空标题。
2. **action tool 默认等待超时为 90 秒**。
3. 已重新评估 Chrome extension `debugger` API / CDP 模式：它可行，能增强截图、坐标输入、导航和部分 DOM/AX 检查能力，但**不能让 ypi web/chat 直接操作 Chrome tab，也不能完全消除 extension 与 ypi web 之间的命令通道**。推荐 MVP 仍采用 content-script snapshot/action + extension 后台命令通道，并把 popup-driven 同步升级为 long-poll/短轮询 + alarms fallback 的后台传输。Debugger-first 作为后续可选增强，不进入本轮默认实现。

## 目标与背景

Browser Share 现有 MVP 支持 Chrome extension 生成短期分享码、ypi web 将分享码绑定到指定 session，并暴露 `browser_share_status/snapshot/get_selection/click/type/scroll/navigate` 等工具。当前体验存在三个断点：

1. New Chat 尚无真实 pi session id 时无法绑定，首轮 agent 无法读取共享页面。
2. 通过 New Chat 预创建 session 后，空 session 可能在列表中显示为 Untitled / 空标题。
3. 当前 action 命令偏“排队 + 手动刷新”，用户期望 chat/agent 能直接操作共享 tab，并自动看到执行结果与新快照。

本次目标是在保持 Browser Share 安全边界的前提下，让用户能在 New Chat 首条消息前绑定 Chrome tab；首条消息后 session 标题立即可识别；并让 action tools 形成“下发命令 → 必要时批准 → extension 执行 → result callback → snapshot 更新 → tool/UI 反馈”的闭环。

## 范围内

- New Chat 未发送前允许绑定 Browser Share。
- New Chat 绑定时懒创建真实但空的 pi session，并将 share code 直接绑定到该 session。
- 首条消息沿用该预创建 session，使 Browser Share tools 在首轮可见绑定。
- 首条消息发送后刷新该预创建 session 的显示标题：MVP 使用第一条用户消息/第一句话作为 title seed，不引入额外 LLM 标题生成。
- Browser Share action tools 等待 terminal 状态，默认超时 90 秒。
- Extension 不再依赖 popup 常驻；后台使用 long-poll/短轮询 + MV3 alarms fallback 与 ypi web 交换命令和结果。
- 记录 debugger API/CDP 的可行能力、限制、安全风险和后续升级路径。

## 范围外 / 非目标

- 不把 `~/gitProjects/ypi-browser-share-extension` 并入 ypi web 仓库、npm 包或 Next build。
- 本轮不默认启用 Chrome `debugger` permission，不做 debugger-first 重写。
- 不引入 Chrome remote debugging 端口或外部 CDP 服务。
- 不做跨机器/公网分享；仍仅面向本机 localhost bridge。
- 不做长期持久化 DOM/page 内容。
- 不实现域名级永久授权；本次只保留一次性批准。
- 不引入 LLM title generation；若未来需要语义标题生成，应单独确认模型、成本和覆盖规则。

## Debugger API / CDP 模式产品判断

### 可替代或增强的能力

Chrome extension 若声明 `debugger` permission，可通过 `chrome.debugger.attach({ tabId }, protocolVersion)` 附着到用户授权/共享的 tab，并使用 CDP 子集：

- `Page.captureScreenshot`：截图能力，适合视觉验证。
- `DOMSnapshot.captureSnapshot` / `Accessibility.getFullAXTree` / `DOM.getDocument`：DOM/布局/AX tree 读取，可辅助元素定位。
- `Runtime.evaluate`：执行页面 JS 采集 DOM 或计算元素 bounding box；本质上仍需要页面内采集逻辑，只是不再注入 content-script 文件。
- `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` / `Input.insertText`：坐标点击、滚轮、键盘输入。
- `Page.navigate`：导航并监听 load/lifecycle。

因此 debugger 模式可增强“坐标级操作、截图、导航等待、动态页面定位”，但不能完全替代服务端 state、用户批准、命令结果回传、脱敏和 session-scoped 绑定。

### 不能完全避免命令通道的原因

- ypi web / chat 运行在网页和 Node/Next 进程中，**不能直接调用 `chrome.debugger`**；该 API 只对 Chrome extension background/service worker 开放。
- 即使 ypi web 保存了 tab 坐标或 tabId，执行者仍必须是 extension。
- Agent tool 是服务端执行，需要把 command 从 ypi web 传给 extension，并把 result/snapshot 从 extension 传回 ypi web。
- 可选传输包括 long-poll/短轮询、WebSocket、SSE/fetch streaming、offscreen document、native messaging、externally_connectable + ypi 页面中转；它们只是替换“命令通道实现”，不会让通道消失。

### 为什么 MVP 不推荐 debugger-first

- `debugger` permission 是高风险权限，会触发明显授权/安全提示；用户信任成本高于 `activeTab + scripting`。
- 同一 tab 只能被一个 debugger 附着；Chrome DevTools、其他插件或自动化工具会冲突。
- 附着时 Chrome 会显示“正在调试此浏览器/标签页”类提示，可能干扰用户体验。
- 仍需要自定义脱敏、元素摘要、用户批准、结果通道和 session 隔离。
- 当前 content-script 方案已能满足文本快照、元素摘要、点击、输入、滚动、导航的 MVP 闭环，权限更小、实现风险更低。

推荐：**保持 content-script + 后台命令通道作为本轮 MVP；把 debugger-first 作为 future enhancement / spike，不阻塞当前功能。**

## 用户故事与验收标准

### US-1：New Chat 首条消息前绑定 Browser Share

- New Chat 有合法 `cwd` 且未 streaming/archived 时，Browser Share 入口可点击。
- 输入有效 share code 后，系统创建真实但空的 pi session，并绑定该 share。
- UI 说明“绑定会先创建 chat/session，使首条消息也能使用共享页面”。

### US-2：预创建 session 首条消息后有可识别标题

- 预创建 session 初始可显示为“待首条消息命名”或等效临时状态。
- 用户发送第一条消息后，session 列表/当前 tab 立即用第一条用户消息截断值刷新标题/firstMessage，不继续显示 Untitled/空标题。
- agent turn 结束或刷新 sessions 后，标题从 JSONL 中的第一条用户消息恢复一致。
- 若用户手动重命名过 session，不被自动标题覆盖。

### US-3：首轮 agent tools 可见共享页面

- 绑定后发送第一条消息，首轮 `browser_share_status` 返回 bound 状态。
- 首轮 `browser_share_snapshot` 能返回最新脱敏快照。
- Agent tools 仍从当前 session 上下文推导绑定，不接受 `shareId`。

### US-4：Chat/agent 可直接操作共享 tab

- `click/type/scroll/navigate` tool 创建 command 后等待 terminal 状态或 90 秒超时。
- Tool live update 展示 pending approval / queued / running / terminal 状态。
- Extension 执行后自动回传 result 和新 snapshot，UI 无需用户手动刷新。
- Tool final result 包含 command id/type/status、message/error、tab、lastSnapshotAt 和 snapshot 摘要。

### US-5：用户明确批准高风险动作

- 默认 permission mode 为 `readonly`。
- `readonly` 模式下所有 action command 都必须批准。
- `interactive` 模式下 `type` 和 `navigate` 必须批准；`click` 和 `scroll` 可直接执行。
- 批准/拒绝只对单个 command 生效。

### US-6：Extension 不依赖 popup 常驻

- popup 关闭时，active share 仍能 best-effort 接收命令并回传结果。
- 推荐传输为 long-poll 优先，空闲时降频，MV3 alarms fallback 负责唤醒。
- UI 显示 last poll / last snapshot / stale/offline 状态。

## 安全与隐私验收

- Agent tools 不接受 `shareId`。
- Share code 短期有效、单次使用，绑定后删除。
- Snapshot 脱敏并限长；不采集 password/payment/token/hidden 值，不读取 cookies/localStorage。
- Command 输入字段、reason、URL、typed text 都有限长；UI 文本预览截断。
- `navigate` 只允许 `http:` / `https:` URL。
- Extension host permissions 只包含 localhost/127.0.0.1 ypi bridge。
- MVP manifest 不新增 `<all_urls>`，不新增 `debugger` permission。

## 未决问题 / 需要主会话确认

1. 是否接受本轮 MVP **不启用 debugger-first**，改为 content-script + 后台 long-poll/alarms command transport？推荐接受。
2. 首条消息后的 session 标题是否采用“第一条用户消息截断”作为 MVP，LLM 语义标题生成后续再立项？推荐接受。
