# Design — Browser Share 服务地址配置与 debugger/CDP 模式

## Evidence reviewed

- ypi web docs: `docs/architecture/browser-share.md`, `docs/modules/api.md`, `docs/modules/frontend.md`, `docs/modules/library.md`.
- ypi web code: `app/api/browser-share/**`, `lib/browser-share-types.ts`, `lib/browser-share-manager.ts`, `lib/browser-share-extension.ts`, `components/BrowserShareControl.tsx`.
- External extension: `~/gitProjects/ypi-browser-share-extension/README.md`, `manifest.json`, `src/service-worker/service-worker.js`, `src/content/snapshot.js`, `src/popup/popup.html`, `src/popup/popup.css`, `src/popup/popup.js`, `scripts/validate.mjs`.

## 方案摘要

分两条主线实施：

1. **服务地址配置**：在外部 Chrome 扩展 popup 中新增 base URL 设置，默认仍为 `http://localhost:30141`；所有 bridge fetch 通过统一 `getBaseUrl()` 使用保存值；对自定义 origin 使用 runtime host permission/optional host permission 策略，避免默认 `<all_urls>`。
2. **debugger/CDP 模式**：作为显式实验模式，由扩展端 attach 当前分享 tab；ypi web 不直接调用 CDP，只接收扩展上传的受限快照/命令结果。现有 content-script 模式保留为默认与 fallback。

## 影响仓库与文件

### ypi web 当前仓库

- `docs/architecture/browser-share.md`：更新服务地址、CDP 模式、权限边界。
- `docs/modules/api.md`：记录 health/capabilities 与 snapshot 可选字段。
- `docs/modules/frontend.md`：记录 BrowserShareControl 新状态展示。
- `docs/modules/library.md`：记录 Browser Share types/manager 支持 capture/debugger metadata。
- `lib/browser-share-types.ts`：新增可选 capture/debugger/baseUrl/capabilities 字段。
- `lib/browser-share-manager.ts`：保存/裁剪新增字段，保持老字段兼容。
- `app/api/browser-share/health/route.ts`：返回 version/capabilities。
- `app/api/browser-share/shares/route.ts`、`snapshot/route.ts`、`commands/result/route.ts`：接受并 sanitize 新字段。
- `components/BrowserShareControl.tsx`：显示 capture/debugger/source 服务状态。
- `lib/browser-share-extension.ts`：必要时在工具结果 summary 中包含 captureMode/debugger 摘要；工具参数仍不得包含 `shareId`。

### 外部扩展仓库 `~/gitProjects/ypi-browser-share-extension`

- `manifest.json`：新增 optional host permission 策略；debugger build/manifest 变体或可验证的 optional debugger 策略。
- `src/popup/popup.html/css/js`：服务地址设置、debugger 开关、连接测试、状态显示。
- `src/service-worker/service-worker.js`：统一 baseUrl、activeShare baseUrl 固化、host permission 检查、CDP attach/capture/command fallback。
- `src/content/snapshot.js`：保留 DOM fallback collector；可能接收 CDP 生成的 debuggerRef/bounds 辅助数据。
- `scripts/validate.mjs`：校验默认无 `<all_urls>`、标准 manifest 无 `debugger`，或 debugger build 明确标识。
- `README.md`：配置服务地址、权限提示、debugger 模式与限制、验证步骤。

## 服务地址配置方案

### 数据模型

扩展 `chrome.storage.local`：

```ts
interface BrowserShareExtensionSettings {
  baseUrl: string; // normalized, no trailing slash, may include reverse-proxy path prefix
  lastHealth?: {
    ok: boolean;
    checkedAt: string;
    service?: string;
    version?: number;
    capabilities?: Record<string, unknown>;
    error?: string;
  };
  debuggerEnabled?: boolean;
  screenshotEnabled?: boolean;
}
```

`activeShare` 继续保存创建时上下文，并新增：

```ts
{
  shareId: string;
  shareCode: string;
  baseUrl: string;      // fixed for this share
  serviceOrigin?: string;
  captureMode?: "dom" | "debugger" | "debugger_fallback";
  debugger?: { enabled: boolean; attached?: boolean; lastError?: string; detachedAt?: string };
}
```

### URL 规范化

- 只允许 `http:` / `https:`。
- 去除末尾 `/`，保留 path 前缀；拼接 API 时使用 `${baseUrl}/api/browser-share/...`。
- 默认值缺失或非法时回退 `http://localhost:30141`。
- 明确禁止 `chrome:`, `file:`, `javascript:` 等非 HTTP URL。

### Host permission

推荐 manifest：

- 保留默认本机 host permission，保证默认路径无额外提示。
- 增加 `optional_host_permissions`：`http://*/*`, `https://*/*`（实际实现需用 Chrome 验证端口匹配规则）。
- 保存非默认 origin 前调用 `chrome.permissions.request({ origins: [originPattern] })`。
- 不默认加入 `<all_urls>` 到 `host_permissions`。

如果 Chrome 对带端口 origin pattern 有限制，实现员需实测并选择最近安全替代：origin 级权限、scheme+host 权限，或文档化开发者手动授权；不得静默改为全量 host 权限。

### Fetch 调用统一化

当前 `service-worker.js` 已有 `getBaseUrl()`，但 popup 健康检查与 activeShare 也需要统一：

- 所有 API URL 由 `apiUrl(path)` 生成。
- `createShare()` 使用当前 settings baseUrl 并写入 activeShare。
- `refreshSnapshot()`、`fetchCommands()`、`postCommandResult()` 优先使用 `activeShare.baseUrl`，确保 active share 不因设置变化串到另一台 ypi。
- `YPI_GET_STATE` 返回 settings 与 activeShare，popup 展示二者差异。

## Debugger/CDP 模式方案

### 权限发布策略

推荐优先级：

1. **最安全推荐**：标准扩展 manifest 不含 `debugger`；另提供 debugger build/manifest（例如 `manifest.debugger.json` 或构建脚本生成）供高级用户加载。
2. **若 Chrome 支持 runtime optional API permission**：把 `debugger` 放入 optional permissions，启用时请求；实现前必须实测。
3. **不推荐**：单一标准插件默认加入 `debugger` permission。这样所有用户安装/更新都承担高风险提示，即使从不使用 debugger。

### 运行时架构

```text
Agent tool / BrowserShareControl
        |
        | existing session-scoped command/state APIs
        v
ypi web BrowserShareManager
        |
        | long-poll command/result, unchanged transport shape
        v
Chrome extension service worker
        |                    |
        | DOM fallback        | optional debugger/CDP attach to shared tab only
        v                    v
content script collector     CDP Page/DOMSnapshot/Accessibility/Runtime/Input
```

ypi web 仍不直接访问 Chrome debugger；CDP 能力全部在 extension service worker 内部封装。

### CDP 可用能力

- `Page.captureScreenshot`：截图，需单独 opt-in/审批，不自动进入默认快照。
- `DOMSnapshot.captureSnapshot` / `DOM.getDocument`：DOM/layout/bounds 摘要来源。
- `Accessibility.getFullAXTree`：AX role/name/tree 摘要来源。
- `Runtime.evaluate`：补充 visible text、selector、敏感字段识别；不得回传 raw values。
- `Input.dispatchMouseEvent` / `Input.insertText`：坐标点击、wheel scroll、输入文本。
- `Page.navigate` + lifecycle events：更稳定导航等待。

### 快照契约扩展

在 `BrowserSharePageSnapshot` 上新增可选字段，旧消费者忽略即可：

```ts
type BrowserShareCaptureMode = "dom" | "debugger" | "debugger_fallback";
interface BrowserShareViewport { width: number; height: number; deviceScaleFactor?: number; scrollX?: number; scrollY?: number; }
interface BrowserShareElementBounds { x: number; y: number; width: number; height: number; }
interface BrowserShareDebuggerSummary {
  enabled: boolean;
  attached?: boolean;
  protocolVersion?: string;
  lastError?: string;
  screenshotAvailable?: boolean;
}

interface BrowserShareInteractiveElement {
  elementId: string;
  tagName: string;
  role?: string;
  label?: string;
  text?: string;
  inputType?: string;
  href?: string;
  isSensitive?: boolean;
  bounds?: BrowserShareElementBounds;
  axRole?: string;
  axName?: string;
  selector?: string;
  frameId?: string;
  debuggerRef?: string;
}

interface BrowserSharePageSnapshot {
  captureMode?: BrowserShareCaptureMode;
  viewport?: BrowserShareViewport;
  debugger?: BrowserShareDebuggerSummary;
  // existing tab/capturedAt/visibleText/selection/focusedElementId/elements/warnings stay unchanged
}
```

Sanitization remains server-side and extension-side:

- `visibleText`、`selection`、`elements` 仍走长度限制。
- `bounds` 只接受有限数字。
- `debuggerRef`、`selector`、`frameId` 限长。
- 不保存 raw DOMSnapshot / AX tree。

### 操作命令兼容

现有 command types 保持：`click`、`type`、`scroll`、`navigate`。

- debugger enabled 且 attach 成功：优先 CDP 执行。
- CDP 执行失败或页面不支持：fallback 到现有 content script / tabs API。
- ypi web 审批规则不因 debugger 改变：readonly 所有 action 都要一次性批准；interactive 中 `type`/`navigate` 仍要批准。
- command result 增加 `captureMode` / `debugger` 摘要与 post-action snapshot。

### 截图取舍

首轮建议不把截图自动塞进 `browser_share_snapshot`，原因：截图会包含所有可见信息，无法像 DOM text 一样可靠脱敏。

可选设计：后续新增 `browser_share_screenshot` 工具或 `capture_screenshot` read command，要求：

- extension popup 勾选 `允许截图上传`；或 ypi web pending approval 单次确认。
- 返回尺寸/字节上限内的 image artifact 或 data URL；超限降采样。
- 不持久化到 session sidecar，除非用户另行确认。

## 后端 API 兼容性

### Health

`GET /api/browser-share/health` 从：

```json
{ "ok": true, "service": "ypi-browser-share", "version": 1 }
```

扩展为：

```json
{
  "ok": true,
  "service": "ypi-browser-share",
  "version": 2,
  "capabilities": {
    "serviceAddressConfig": true,
    "captureModes": ["dom", "debugger"],
    "commandLongPoll": true,
    "screenshot": "opt-in"
  }
}
```

旧插件仍只需 `res.ok`。

### Create share / snapshot / result

- `POST /api/browser-share/shares` 接受可选 `extensionVersion`、`baseUrl`、`capabilities`、`captureMode`、`debugger`。
- `POST /shares/[shareId]/snapshot` 接受扩展后的 snapshot 字段。
- `POST /commands/[commandId]/result` 接受 result 中的扩展 snapshot/debugger metadata。
- 未识别字段忽略或裁剪；错误响应保持 `{ error }`。

### State

`GET /api/browser-share/sessions/[sessionId]/state` 增加可选展示字段：

- `source?: { baseUrl?: string; origin?: string }`
- `captureMode?: BrowserShareCaptureMode`
- `debugger?: BrowserShareDebuggerSummary`

不改变 `bound/status/tab/snapshot/commands` 基本结构。

## 权限与安全边界

- 服务地址配置不等于 ypi web 公网安全；ypi web 仍应运行在本机、可信局域网或受保护反代后。
- 插件不保存 ypi web cookies/localStorage；本任务不引入通用登录。
- 非默认 origin 必须显式授权 host permission。
- Debugger 模式必须显式启用；标准插件默认不含 debugger 权限是推荐方案。
- Debugger attach 仅限 activeShare.tabId，停止分享时 detach。
- Raw CDP 数据不直接上报给 ypi web；只上报白名单摘要。
- 截图默认关闭，若启用必须提示敏感可见信息风险。
- Agent tools 不接受 `shareId`、`tabId`、`baseUrl` 等可跨会话操作参数。

## 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 自定义地址指向公网 ypi | 整个 ypi web 暴露风险 | UI/README 明确只支持可信网络；公网鉴权另立任务。 |
| Chrome host permission 规则复杂 | LAN/端口授权失败 | 先实测 optional_host_permissions；失败时文档化安全替代，不默认 `<all_urls>`。 |
| `debugger` 权限吓退用户 | 安装/信任成本上升 | 标准/Debugger 双构建或 optional permission；默认 DOM 模式。 |
| DevTools/其他调试器冲突 | attach 失败或影响用户 | attach 失败自动 fallback；状态显示 lastError；finally detach。 |
| CDP 数据过大 | 内存/上下文膨胀 | 严格字段白名单、数量/长度限制、截图单独 opt-in。 |
| 动态页面元素 stale | 操作失败 | CDP bounds + content-script fallback；失败后上传新 snapshot。 |
| MV3 service worker 休眠 | 命令延迟 | 保持现有 long-poll + alarms；popup 显示 best-effort 状态。 |

## 回滚方案

- 服务地址：重置 `chrome.storage.local.baseUrl` 到默认 localhost；保留旧 bridge API。
- Host permission：移除 optional host permissions 后默认本机仍可工作。
- Debugger：切回标准 manifest/build；`debuggerEnabled=false`；CDP 字段为可选，ypi web 忽略即可。
- ypi web 类型扩展：可保留兼容字段，不影响旧 DOM snapshots。
