# design

## 项目组织

推荐平级独立项目：

```text
pi-agnet-web.worktrees/pi-*/        # 当前 ypi web 项目
../ypi-browser-share-extension/     # Chrome MV3 插件项目
```

ypi web 主项目仅包含：

- Browser Share bridge 后端 API。
- Browser Share session 状态管理。
- agent tools 注册。
- ChatInput/ChatWindow 状态与授权 UI。
- 文档中说明插件仓库路径和联调方式。

如果未来必须放入同仓，建议路径为 `external/browser-share-extension/`，并同步更新：

- `package.json.files` 排除该目录。
- `next.config.ts.outputFileTracingExcludes` 排除该目录。
- eslint/tsconfig 视情况排除，避免主应用 lint/build 扫描插件产物。

## 运行时架构

```text
Chrome Extension MV3
  popup / service worker / content script
        |
        | HTTP polling/SSE 或 WebSocket，localhost only
        v
ypi web Browser Share bridge
  app/api/browser-share/**
  lib/browser-share-manager.ts
        |
        | sessionId 绑定
        v
AgentSession tools
  browser_share_snapshot
  browser_share_get_selection
  browser_share_click
  browser_share_type
  browser_share_scroll
  browser_share_navigate
```

## 通信协议

MVP 推荐 HTTP + 短轮询，避免 WebSocket 在 Next runtime 中引入额外复杂度；后续可升级 WebSocket。

### 配对与分享码

1. 插件启动后调用 `GET /api/browser-share/health` 检查 ypi。
2. 用户点击“分享当前页”后，插件调用：
   - `POST /api/browser-share/shares`
   - body: `{ extensionInstanceId, tab, permissionMode, pagePreview }`
3. 后端生成：
   - `shareId`: 内部 id
   - `shareCode`: 6-8 位短码
   - `expiresAt`: 默认 5 分钟
4. 用户在目标 chat 输入 shareCode 后，前端调用：
   - `POST /api/browser-share/sessions/[sessionId]/bind`
   - body: `{ shareCode }`
5. 后端将 share 绑定到 sessionId，shareCode 立即失效。

### 插件上报

- `POST /api/browser-share/shares/[shareId]/snapshot`
- 内容包括 URL/title、visibleText 摘要、selection、focused element、interactive elements。
- 禁止上报 password/input[type=password] value、信用卡字段、token-like 字段、隐藏字段值。

### 命令执行

agent 工具发起操作后，后端创建 command：

- `POST /api/browser-share/sessions/[sessionId]/commands`
- 插件轮询：`GET /api/browser-share/shares/[shareId]/commands?after=...`
- 插件执行后回报：`POST /api/browser-share/commands/[commandId]/result`

高风险命令先进入 `pending_approval`，需要 ypi UI 或插件端确认后才会被插件拉取。

## 后端模块

新增建议：

- `lib/browser-share-types.ts`：wire types。
- `lib/browser-share-manager.ts`：in-memory + 可选 sidecar 状态管理。
- `app/api/browser-share/health/route.ts`
- `app/api/browser-share/shares/route.ts`
- `app/api/browser-share/shares/[shareId]/snapshot/route.ts`
- `app/api/browser-share/sessions/[sessionId]/bind/route.ts`
- `app/api/browser-share/sessions/[sessionId]/state/route.ts`
- `app/api/browser-share/sessions/[sessionId]/commands/route.ts`
- `app/api/browser-share/commands/[commandId]/result/route.ts`

MVP 可使用 `globalThis.__browserShareManager` 保存本机短生命周期状态；无需持久保存页面内容。

## agent 工具

工具名建议：

- `browser_share_status`：查看当前 session 是否绑定浏览器。
- `browser_share_snapshot`：读取当前页面快照。
- `browser_share_get_selection`：读取用户选中文本和上下文。
- `browser_share_click`：点击指定 elementId。
- `browser_share_type`：向指定 elementId 输入文本。
- `browser_share_scroll`：滚动页面或元素。
- `browser_share_navigate`：导航到 URL，高风险，默认需确认。

工具实现应在 ypi web 创建 AgentSession 时注册到 pi extension；所有工具必须从当前 sessionId 推导绑定，不允许传任意 shareId 绕过 session 绑定。

## Chrome MV3 权限

MVP manifest：

- `permissions`: `activeTab`, `scripting`, `storage`
- `host_permissions`: `http://localhost:30141/*`, `http://127.0.0.1:30141/*`
- 不默认申请 `<all_urls>`。

content script 仅在用户点击分享后通过 `scripting.executeScript` 注入当前 active tab。

## 安全边界

- 本机 localhost only；默认拒绝 LAN origin。
- shareCode 单次使用、短期过期、随机生成。
- session 绑定后，agent 工具仅在该 session 可用。
- 默认只读；写操作需要 approval。
- 敏感字段不采集 value；type=password 永不读取。
- 对 submit、payment、auth、跨域 navigation 增加高风险确认。
- 页面快照做长度限制和字段白名单。
- command/result 记录最小审计信息，不持久化完整 DOM。
