# brief

## 目标与背景

用户反馈集中在 Browser Share 的两个体验断点：

1. New Chat 还没有真实 pi session id 时，`绑定浏览器分享` 入口被置灰，必须先发第一条消息才能绑定；这会导致首轮 agent 不能直接读取/操作共享页面。
2. 当前体验偏“快照查看”：用户需要在浏览器手动操作并刷新快照；期望 chat/agent tools 能对当前共享 tab 下发 `click/type/scroll/navigate` 等命令，并自动看到执行结果与新快照。

已有架构约束：

- Chrome MV3 extension 独立在 `~/gitProjects/ypi-browser-share-extension`，不进入 ypi web npm/Next build。
- ypi web 已有 `app/api/browser-share/**`、`lib/browser-share-manager.ts`、`lib/browser-share-extension.ts`。
- agent tools 必须从当前 session 上下文推导 Browser Share 绑定，不接受 `shareId`。
- 安全边界保持：默认 readonly；`type/navigate` 需要用户批准；readonly 对所有 action command 都要批准；snapshot 脱敏和限长。

## 范围内

- New Chat 未发送前允许绑定 Browser Share，并保证首条消息的 agent tools 能使用该绑定。
- Browser Share action tools 形成“下发命令 → 用户确认（如需）→ extension 执行 → result callback → snapshot 更新 → tool/UI 反馈”的闭环。
- ypi web 与外部 extension 的协议/状态更新设计。
- 明确需要改动的 web 文件与 extension 文件边界。
- 验收标准、安全门禁和剩余风险。

## 范围外

- 不把 extension 并入 ypi web 仓库或发布包。
- 不引入 Chrome remote debugging/CDP。
- 不做跨机器/公网分享；仍仅面向本机 localhost bridge。
- 不做长期持久化页面内容；Browser Share 状态仍以短生命周期内存状态为主。
- 不实现域名级永久授权；本次只保留一次性批准。

## 推荐方案摘要

### New Chat 绑定

推荐最小风险方案：**在用户于 New Chat 首次绑定 Browser Share 时，懒创建一个真实但空的 pi session，然后把分享码直接绑定到这个真实 session id**。

不推荐本轮采用：

- `draftId` 临时绑定再 transfer：会引入新生命周期、转移竞态、清理和安全边界复杂度。
- 仅 UI pending binding，首条消息时再绑定：容易出现首轮 prompt 已发送而 Browser Share 尚未绑定的竞态。
- New Chat 打开即预创建 session：会产生大量用户未确认的空 session。

推荐理由：复用现有 session-scoped 安全模型；tools 仍只从当前 session 推导绑定；首轮消息前绑定已经存在；实现面主要集中在 `useAgentSession`、`ChatWindow`、`BrowserShareControl` 和一个“创建空 session”API。

### Chat 直接操作 tab

保留现有 server command queue/result callback 架构，补齐三点：

1. **extension 后台轮询/自动快照**：不再依赖 popup 打开或手动刷新；active share 存在时 service worker 负责轮询命令、执行后回传 result，并在 tab 变化/操作后自动上传快照。
2. **tools 等待执行结果**：`browser_share_click/type/scroll/navigate` 不只返回 queued command，而是等待批准/执行/失败/超时，并把 command status、result、snapshot 摘要返回给 agent，同时用 `onUpdate` 推送进度。
3. **前端批准与状态反馈**：`BrowserShareControl` 显示 bound tab、last snapshot、pending/running command、一次性批准/拒绝；轮询频率在有 pending/running 时加快。

## 验收标准

- New Chat 未发送消息时，Browser Share 入口可点击；输入有效 share code 后能绑定并显示 tab 信息。
- 绑定后发送第一条消息，agent 在同一首轮即可调用 `browser_share_status/snapshot` 看到共享页。
- action tool 发起后：
  - readonly 模式下所有 action 都进入待确认；interactive 模式下 `type/navigate` 待确认，`click/scroll` 可直接 queued。
  - 用户允许一次后 extension 执行对应 tab 操作并回传结果。
  - tool result 中包含 terminal status 与更新后的 snapshot/lastSnapshotAt。
  - ypi UI 不需要用户手动点击 extension 的“刷新快照”。
- 拒绝、tab 关闭、extension 离线、元素不存在、敏感字段、超时等场景都有明确错误反馈。
- `shareId` 仍不暴露给 agent tool 参数。

## 未决问题 / 需要主会话确认

1. 是否接受“用户在 New Chat 点击绑定时创建一个空 pi session，并可能出现在 session 列表中”的产品取舍？这是本方案的最小风险代价。
2. action tool 等待用户批准的默认超时时间建议 90 秒；是否需要更短/更长？
3. extension 后台实时性是否接受“短轮询 + MV3 alarm fallback”的 MVP，还是必须投入更复杂的 SSE/WebSocket/offscreen document 方案？
