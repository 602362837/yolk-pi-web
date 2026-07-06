# Checks — Browser Share New Chat 绑定、标题刷新与 Tab 操作通道

## 检查目标

确认本功能满足：

- New Chat 未发送首条消息前可绑定 Browser Share。
- 预创建空 session 在首条消息后刷新标题，不长期显示 Untitled/空标题。
- 首轮 agent tools 能看到共享 tab。
- `click/type/scroll/navigate` 返回 terminal 结果，默认等待 90 秒。
- Extension popup 关闭时仍能通过后台 transport best-effort 执行命令并回传 snapshot。
- MVP 不启用 debugger-first，不新增 `debugger` / `<all_urls>` 权限。

## 决策前置检查

已确认：

- [x] 接受 New Chat 绑定时懒创建真实空 pi session。
- [x] action tool 默认等待超时时间采用 90 秒。

仍需主会话确认：

- [ ] 本轮 MVP 不启用 debugger-first，采用 content-script + background long-poll/alarms transport。
- [ ] 首条消息后的 session 标题采用第一条用户消息截断作为 MVP；LLM 语义标题生成后续另行立项。

## 自动验证

### ypi web repo

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

通过标准：

- [ ] ESLint 通过。
- [ ] TypeScript `--noEmit` 通过。
- [ ] 未直接运行 `next build` 作为常规开发验证。

### external extension repo

```bash
cd ~/gitProjects/ypi-browser-share-extension
npm run build
```

通过标准：

- [ ] Extension validation/build 通过。
- [ ] 如果新增 `alarms` permission，manifest 合法且 reload 后无权限错误。
- [ ] Manifest 未新增 `<all_urls>`。
- [ ] MVP manifest 未新增 `debugger`。
- [ ] Host permissions 仍只指向 localhost/127.0.0.1 ypi bridge。

## API / 状态基础检查

### `/api/agent/draft`

- [ ] 缺少 `cwd` 返回 400。
- [ ] 非目录 cwd 返回 400。
- [ ] 合法 cwd 返回 `{ success: true, sessionId }`。
- [ ] 不发送 prompt；创建后 session messageCount 为 0 或无用户首条消息。
- [ ] 带 `provider/modelId` 时模型设置成功。
- [ ] 带 `toolNames` 时工具预设生效。
- [ ] 带非 `auto` `thinkingLevel` 时推理强度设置成功。

### Browser Share routes

- [ ] `shares/[shareId]/commands?waitMs=...` 支持 bounded long-poll。
- [ ] long-poll/commands route 更新 `lastCommandPollAt` / heartbeat。
- [ ] queued command 被 extension 拉取后进入 running。
- [ ] approval route approve 后 `pending_approval -> queued`。
- [ ] approval route reject 后 `pending_approval -> rejected` terminal。
- [ ] result route 成功后 `running -> succeeded` 并更新 snapshot。
- [ ] result route 失败后 `running -> failed` 并保留错误 message。
- [ ] timeout 后 command 进入 `timeout` terminal，且不会被后续 extension 执行。
- [ ] state route 返回 active commands、recent terminal commands、connection/heartbeat projection。

## New Chat 首次绑定检查

### New Chat UI

- [ ] 打开 New Chat，尚未发送消息。
- [ ] `绑定浏览器分享`按钮不是灰色，前提是有 `cwd` 且未 streaming/archived。
- [ ] Tooltip/说明文案告知：绑定会先创建 chat/session，使首条消息可使用共享页面。
- [ ] 空 share code 不触发 draft session 创建。
- [ ] 明显非法格式 share code 不触发 draft session 创建。

### Bind 成功

- [ ] Extension 生成 share code。
- [ ] New Chat 输入 share code 并绑定。
- [ ] ypi UI 显示 bound tab title/url/origin。
- [ ] ypi UI 显示 permission mode。
- [ ] ypi UI 显示 last snapshot 或连接/心跳状态。
- [ ] Session 列表或当前 tab 收到真实 session id。
- [ ] 重复点击绑定/快速双击不会创建多个 draft session。
- [ ] 首条消息前，临时标题状态不会误导为已命名；可显示“待首条消息命名”等。

### Bind 失败

- [ ] 过期 share code 返回明确错误。
- [ ] 已使用 share code 返回明确错误。
- [ ] 格式有效但过期导致已创建空 session 时，UI 错误清晰，不误报已绑定。

## 首条消息标题刷新检查

- [ ] 在通过 Browser Share 预创建的 New Chat 中发送第一条消息。
- [ ] 首条消息走 `/api/agent/[precreatedSessionId]`，不是 `/api/agent/new`。
- [ ] 发送后当前 session/侧边栏标题立即刷新为第一条用户消息截断值或等效 title seed。
- [ ] 标题不继续显示 Untitled、空标题或 `(no messages)`。
- [ ] agent turn 结束后 sessions reload，标题/firstMessage 仍与 JSONL 中第一条用户消息一致。
- [ ] 若用户手动重命名过 session，自动 title seed 不覆盖 `session.name`。
- [ ] 普通非 Browser Share New Chat 标题行为不回归。

## 首轮 tools 可见检查

- [ ] 在已绑定但尚未发送任何消息的新 chat 中发送：“请调用 browser_share_status 和 browser_share_snapshot，总结当前页面。”
- [ ] `browser_share_status` 首轮返回 `bound: true`。
- [ ] `browser_share_snapshot` 首轮返回共享页 URL/title/visible text/elements。
- [ ] 工具结果来自当前 session 绑定，无需也没有传入 `shareId`。
- [ ] 未预创建 Browser Share 的普通 New Chat 首条消息仍正常创建 session 并回复。

## 权限矩阵检查

### readonly 模式

- [ ] `browser_share_click` 进入 `pending_approval`，UI 显示批准卡。
- [ ] `browser_share_scroll` 进入 `pending_approval`，UI 显示批准卡。
- [ ] `browser_share_type` 进入 `pending_approval`，UI 显示批准卡，并截断 typed text preview。
- [ ] `browser_share_navigate` 进入 `pending_approval`，UI 显示目标 URL/origin 变化提示。
- [ ] 点击“允许一次”后 command 进入 queued/running 并最终 succeeded/failed。
- [ ] 点击“拒绝”后 command 进入 rejected，extension 不执行。

### interactive 模式

- [ ] `browser_share_click` 可不经批准直接 queued/running。
- [ ] `browser_share_scroll` 可不经批准直接 queued/running。
- [ ] `browser_share_type` 仍进入 `pending_approval`。
- [ ] `browser_share_navigate` 仍进入 `pending_approval`。
- [ ] interactive 模式仍拒绝敏感字段操作。

## Action execution 检查

### Click

- [ ] 对普通 button/link 的 `elementId` 调用 `browser_share_click`。
- [ ] Tool live update 展示 queued/running/terminal 状态。
- [ ] Extension 执行 click。
- [ ] Tool final result 为 terminal 状态，不只是 queued。
- [ ] Result 包含 command id/type/status/message/tab/lastSnapshotAt/snapshot summary。
- [ ] UI last snapshot 时间更新。

### Type

- [ ] 对普通 text input 调用 `browser_share_type`，批准后输入文本生效。
- [ ] 页面触发 `input`/`change` 后快照反映新状态。
- [ ] 对 password/token/payment-like 字段调用 type 时被拒绝，message 清晰。
- [ ] UI typed text preview 截断，不展示超长全文。

### Scroll

- [ ] 对长页面调用 `browser_share_scroll`。
- [ ] 页面滚动，自动上传新 snapshot。
- [ ] readonly 下需要批准；interactive 下可直接执行。
- [ ] 缺省 delta 时使用合理默认值。
- [ ] 非有限 number delta 输入被拒绝。

### Navigate

- [ ] 调用 `browser_share_navigate` 到 `https://...`，批准后 tab 跳转。
- [ ] Extension 等待 load/settle 后上传新 snapshot。
- [ ] Tool result 显示新 URL/title/lastSnapshotAt。
- [ ] `http://...` 允许但仍需批准。
- [ ] `file:`, `chrome:`, `javascript:`, 空 URL、非法 URL 在 enqueue 前被拒绝。
- [ ] Origin 变化在批准 UI 中明确展示。

## Transport / popup / MV3 检查

- [ ] Popup 关闭后，active share 的 command 仍 best-effort 执行。
- [ ] Service worker 使用 guarded long-poll；同一 share 不发生并发 poll 风暴。
- [ ] Network 失败时有 backoff，不崩溃。
- [ ] `chrome.alarms` fallback 能唤醒或重启 command loop。
- [ ] UI connection 能显示 active/stale/offline 或等效状态。
- [ ] Popup 打开时显示 active share、last poll、last snapshot、last command 状态。
- [ ] “刷新快照”仍可作为手动 fallback。
- [ ] README 不再声称必须保持 popup 打开才能测试 action。

## Debugger / CDP 边界检查

MVP 应满足：

- [ ] Extension manifest 未新增 `debugger` permission。
- [ ] Extension manifest 未新增 `<all_urls>`。
- [ ] README 说明 MVP 不使用 debugger/CDP，后续若启用需要额外授权与风险确认。
- [ ] 设计文档解释 debugger 不能消除 ypi web ↔ extension 命令通道。

若未来单独启用 debugger spike，需额外检查：

- [ ] 用户看到并接受 `debugger` 权限/调试提示。
- [ ] attach/detach 成功且 DevTools 冲突有清晰错误。
- [ ] CDP screenshot/DOM/AX/coordinate input/navigation 能力验证通过。
- [ ] Raw DOM/AX/screenshot 不默认暴露给 agent；仍走 bounded sanitized snapshot。

## 错误与异常场景检查

- [ ] 用户拒绝 pending command 后 tool 返回 `rejected`，extension 不执行。
- [ ] 需要批准的 command 超过 90 秒未批准后返回 `timeout`。
- [ ] Extension 离线/未轮询时 UI 进入 stale/offline，tool 最终 timeout。
- [ ] 绑定后关闭共享 tab，command failed/timeout 且 message 指出 tab closed/inaccessible。
- [ ] 使用过期/不存在 `elementId` 时 result failed 且尽可能包含 fresh snapshot。
- [ ] Snapshot 不包含 password、payment、token/secret/OTP、hidden field values。
- [ ] Server 侧 snapshot 限长仍生效。

## 多 session / 隔离检查

- [ ] 两个 ypi sessions 同时打开时，share code 只绑定目标 session。
- [ ] 另一个 session 调用 `browser_share_status` 不会看到该 share。
- [ ] Agent tool 参数 schema 中没有 `shareId`。
- [ ] UI/API 不允许通过任意 `shareId` 让 agent 操作其他 session 的 tab。
- [ ] 绑定新 share 到同一 session 时旧 share active commands 被终止并有反馈。

## UI 回归检查

- [ ] Existing session 中 Browser Share bind/unbind 仍正常。
- [ ] Archived session 输入区仍禁用，不允许绑定/发送。
- [ ] Streaming 时 bind/approval 操作 disabled/loading 合理，不重复提交。
- [ ] Pending approval 卡片在窄宽度下不遮挡主要输入操作。
- [ ] 普通 New Chat 未使用 Browser Share 时 model/tool/thinking 选择和发送行为不回归。

## 文档检查

ypi web docs:

- [ ] `docs/architecture/browser-share.md` 描述 lazy empty session、首条消息标题刷新、command lifecycle、long-poll transport、安全边界、debugger deferral。
- [ ] `docs/modules/api.md` 增加 `/api/agent/draft` 并更新 Browser Share route 行为。
- [ ] `docs/modules/frontend.md` 更新 `BrowserShareControl`、`ChatInput`、`useAgentSession` 职责。
- [ ] `docs/modules/library.md` 更新 Browser Share manager/types/extension 描述。

Extension docs:

- [ ] `~/gitProjects/ypi-browser-share-extension/README.md` 更新后台 best-effort transport 和当前限制。
- [ ] README 说明本地 localhost-only、安全脱敏、一次性批准。
- [ ] README 说明 MVP 不使用 debugger；debugger-first 需要未来额外授权。

## 退出标准

- [ ] Web 自动验证通过。
- [ ] Extension 自动验证通过。
- [ ] New Chat 首次绑定通过。
- [ ] 首条消息标题刷新通过。
- [ ] 首轮 tools 可见通过。
- [ ] `click/type/scroll/navigate` 权限矩阵与 terminal result 通过。
- [ ] popup 关闭时后台 transport best-effort 通过。
- [ ] 拒绝/超时/离线/tab 关闭/敏感字段/非法 URL/元素不存在均有明确反馈。
- [ ] Docs 已同步。
- [ ] 未决产品决策已记录最终答案。
