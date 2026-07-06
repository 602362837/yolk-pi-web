# design

## 方案摘要

将 Browser Share 改为 persistent debugger-first 生命周期：扩展成功创建 share 后立即并持续 attach Chrome debugger 到所选 tab；刷新快照和命令复用该 debugger session，不再在每次操作后 detach。释放 debugger 只发生在用户停止分享、ypi 解绑/替换、分享码过期、tab 关闭或 debugger 被外部接管等明确事件。ypi web 与扩展通过 heartbeat/command response 同步 lifecycle、debugger、operator 状态，UI 明确展示谁能读取/操作。

## 生命周期状态机

### 扩展 activeShare / debugger 状态

```text
idle
  -> preparing_share
  -> attaching_debugger
  -> code_pending_attached
  -> bound_live_attached

code_pending_attached
  -> expired_detaching -> idle
  -> stopped_by_user -> idle
  -> debugger_lost -> debugger_unavailable

bound_live_attached
  -> command_running -> bound_live_attached
  -> ypi_unbound_or_replaced -> detaching -> idle
  -> tab_closed -> terminal_tab_closed -> idle
  -> debugger_lost -> debugger_unavailable
  -> service_offline -> bound_local_only_attached

bound_local_only_attached
  -> service_restored -> bound_live_attached
  -> stopped_by_user -> idle

debugger_unavailable
  -> reattach_succeeded -> previous_live_state
  -> stopped_by_user/tab_closed/ypi_unbound -> idle
```

含义：

- `code_pending_attached`：share code 仍有效但尚未绑定，Chrome debugger 已常驻；无 ypi session 可操作。
- `bound_live_attached`：已绑定，心跳正常，debugger attached。
- `bound_local_only_attached`：ypi 暂不可达，但 debugger 仍保持，用户可停止分享。
- `debugger_unavailable`：share 仍存在但 debugger 不可用；action tools 必须失败，不允许静默 content-script 操作。

### ypi web share lifecycle

建议新增 server 侧 projection，而不是复用单一 `status` 表达所有含义：

```ts
export type BrowserShareLifecycleStatus =
  | "pending_code"
  | "bound"
  | "stale"
  | "offline"
  | "stopped"
  | "unbound"
  | "replaced"
  | "expired"
  | "tab_closed"
  | "not_found";
```

- active records：`pending_code` / `bound` / `stale` / `offline`。
- terminal/tombstone：`stopped` / `unbound` / `replaced` / `expired` / `tab_closed` / `not_found`。
- `stale/offline` 由 heartbeat age 推导，不一定删除绑定。

### Command 子状态

沿用现有 command lifecycle：

```text
pending_approval -> queued -> running -> succeeded/failed
pending_approval -> rejected
queued/running -> timeout
```

变化：extension 只有在 persistent debugger `attached` 时执行 action。若 debugger 不可用，命令应快速 `failed`，message 指向 debugger 状态，而不是尝试隐式临时 attach/detach 或 content-script 操作。

## Chrome debugger attach/detach 策略

### Attach

1. 点击 `分享当前页` 后，先检查 ypi health 支持 `persistentDebugger`。
2. 获取 active tab，拒绝 `chrome://` 等不可调试/不可分享 scheme。
3. `ensureDebuggerAttached(tabId, shareId)`：
   - idempotent；若已由本扩展 attach，更新状态即可。
   - attach 后 enable `Page`、`Runtime`，必要时启用输入相关 domain。
   - 写入 `activeShare.debugger = { desired: true, persistent: true, state: "attached", attached: true, attachedAt }`。
4. 使用已 attach 的 debugger 采集初始 snapshot，再 `POST /api/browser-share/shares` 创建 share code。
5. 若 server 创建失败，立即 detach 并清除 activeShare，避免无授权常驻 debugger。

### 复用

- `collectDebuggerSnapshot` 不再 finally detach；改为依赖 `ensureDebuggerAttached`。
- `executeDebuggerCommand` 不再 finally detach；命令后保持 attached。
- 命令执行前如果状态不是 attached：
  - 可以执行一次 `ensureDebuggerAttached` 来恢复“应常驻但丢失”的状态；成功后先更新 UI/heartbeat，再执行。
  - 失败则返回 failed，不做 content-script action fallback。
- snapshot 可保留 DOM fallback，但必须标记 `captureMode: "debugger_fallback"` 与 `debugger.state !== "attached"`；action 不降级。

### Detach

必须 detach 的事件：

- popup 点击 `停止分享并释放 debugger`。
- ypi web `DELETE /sessions/[sessionId]/bind` 或 session rebind 产生 tombstone，extension 在 heartbeat/commands 中收到 `detachRequested`。
- share code 未绑定过期。
- tab closed / target closed。
- 创建新 share 替换旧 activeShare。
- 扩展卸载/浏览器关闭由 Chrome 自动清理；startup 后根据 storage 恢复或清除。

意外 detach：

- 监听 `chrome.debugger.onDetach`，若 `activeShare.debugger.desired === true`：
  - 更新 `debugger.state = "detached" | "blocked"`、`detachReason`、`detachedAt`。
  - 上报 heartbeat，让 ypi UI/tool 可感知。
  - 对 active action command 返回 failed。
  - 可提供手动或有限自动重试；如果 reason 指向 DevTools/另一个 debugger，优先提示用户处理冲突。

## 数据流 / API / 文件契约

### 类型扩展：`lib/browser-share-types.ts`

建议向后兼容地扩展现有类型：

```ts
export type BrowserShareDebuggerState = "unsupported" | "attaching" | "attached" | "detached" | "blocked" | "failed";

export interface BrowserShareDebuggerSummary {
  enabled: boolean;
  attached?: boolean;
  persistent?: boolean;
  desired?: boolean;
  state?: BrowserShareDebuggerState;
  attachedAt?: string;
  detachedAt?: string;
  detachReason?: string;
  protocolVersion?: string;
  lastError?: string;
  screenshotAvailable?: boolean;
}

export interface BrowserShareOperatorInfo {
  bindingStatus: "none" | "pending_code" | "bound" | "unbound";
  serviceBaseUrl?: string;
  boundSessionId?: string;
  boundSessionLabel?: string;
  permissionMode?: BrowserSharePermissionMode;
  canRead: boolean;
  canOperate: boolean;
  autoAllowedCommands: BrowserShareCommandType[];
  approvalRequiredCommands: BrowserShareCommandType[];
}
```

`BrowserShareSessionState` 建议新增：

- `lifecycleStatus?: BrowserShareLifecycleStatus`
- `operator?: BrowserShareOperatorInfo`
- `detachRequested?: boolean`（主要给 extension control projection）
- 扩展 `debugger` 继续沿用并增加 optional 字段，旧客户端不破坏。

### Manager：`lib/browser-share-manager.ts`

新增职责：

- 保存 `lifecycleStatus`、persistent debugger summary、operator projection。
- 保存短 TTL tombstone（建议 10 分钟），用于 ypi unbind/rebind/expired/tab_closed 后让 extension 通过 shareId 知道应 detach，而不是无限空轮询。
- 新增 `updateShareRuntime(shareId, runtime)`：处理 heartbeat/debugger/tab/transport 摘要。
- 新增 `stopShareFromExtension(shareId, reason)`：extension 主动停止时删除 session binding、fail active commands、写 tombstone。
- 新增 `getShareControlProjection(shareId)`：供 heartbeat/commands 返回 `{ lifecycleStatus, detachRequested, detachReason, boundSessionId, permissionMode, expiresAt }`。
- `removeShare` 改为写 tombstone；active commands 继续 fail。

### API routes

新增/增强：

| Route | 变化 |
| --- | --- |
| `GET /api/browser-share/health` | version 升至 3；capabilities 增加 `persistentDebugger`, `shareHeartbeat`, `commandControlProjection`, `activeShareOperator`。 |
| `POST /api/browser-share/shares` | 接受 `debugger.persistent/state/attachedAt`；若新扩展声明 persistent 则 state 初始为 `pending_code`。 |
| `POST /api/browser-share/shares/[shareId]/heartbeat` | 新增。扩展上报 debugger/tab/transport 状态；返回 control projection，含 `detachRequested`。 |
| `DELETE /api/browser-share/shares/[shareId]` | 新增。扩展停止分享/tab 关闭时通知服务端清绑定并写 tombstone。 |
| `GET /api/browser-share/shares/[shareId]/commands` | 返回 `{ commands, share }`；share 不存在但有 tombstone 时返回 410 + detach reason；不再让 extension 无限空轮询。 |
| `GET /api/browser-share/sessions/[sessionId]/state` | 增加 `lifecycleStatus`, `operator`, persistent debugger fields；connection 状态继续由 heartbeat age 推导。 |
| `DELETE /api/browser-share/sessions/[sessionId]/bind` | 除删除绑定外写 tombstone，让 extension 下次 poll/heartbeat detach。 |

### Extension：`~/gitProjects/ypi-browser-share-extension`

影响文件：

- `src/service-worker/service-worker.js`
  - 新增 persistent debugger controller：`ensureDebuggerAttached`、`releaseDebugger`、`syncDebuggerState`、`chrome.debugger.onDetach`。
  - 去除 snapshot/action 内部 finally detach。
  - 新增 heartbeat、server tombstone/410 handling、tab removed/updated handling、badge updates。
  - Stop share 调用 ypi `DELETE /shares/[shareId]` 后 detach。
- `src/popup/popup.html/js/css`
  - Active share 卡片重构，展示 operator/debugger/lifecycle。
  - 新文案和错误处理。
- `README.md`
  - 更新为常驻 debugger 模型与隐私提示。

### ypi web UI/tools

- `components/BrowserShareControl.tsx`
  - 展示 operator/debugger/lifecycle 字段和新文案。
  - debugger unavailable 时以醒目状态提示。
- `lib/browser-share-extension.ts`
  - action tools 在 enqueue 前或结果中明确检查/返回 persistent debugger 状态；避免让用户误以为命令只是排队。
  - promptGuidelines 更新：Browser Share action 只在常驻 debugger attached 时执行。
- `docs/architecture/browser-share.md`、`docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`
  - 实施完成后同步文档。

## 兼容性与迁移

- 旧扩展 -> 新 ypi web：缺少 `debugger.persistent` 时仍可绑定，但 ypi UI 标记“旧版插件：debugger 可能按需连接，请更新扩展”。不应强行假设 attached。
- 新扩展 -> 旧 ypi web：health 无 `persistentDebugger` 时，推荐阻止创建分享并提示更新 ypi web；若主会话要求兼容，可提供显式 legacy 模式，但不作为默认。
- Server restart：当前 BrowserShareManager 是内存态，重启会丢 share；新扩展应在 poll/heartbeat 发现 404/410/not_found 后 detach 并提示重新分享。
- Existing activeShare storage：扩展升级后若发现缺少 persistent fields，可尝试恢复 attach 并上报；失败则标记需要重新分享。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| Chrome debugger 与 DevTools/其他扩展冲突 | attach 失败阻止创建；运行中 onDetach 标红并禁止 action；提示用户关闭冲突来源。 |
| MV3 service worker suspend 导致心跳间隔 | activeShare 存 storage；startup/alarm/onMessage 恢复 `ensureDebuggerAttached` 和 long-poll；ypi UI 用 stale/offline 表达。 |
| ypi unbind 后扩展继续 attached | server tombstone + commands 410 + heartbeat `detachRequested`；extension 收到后 detach。 |
| 常驻 debugger 让用户担忧 | UI 明确“谁可以操作”和停止按钮；Chrome infobar + badge 持续提示。 |
| 页面 overlay 影响业务页面 | MVP 不做持久 overlay。 |
| 只读 DOM fallback 形成隐式降级 | action 不 fallback；snapshot fallback 必须显式标记。 |
