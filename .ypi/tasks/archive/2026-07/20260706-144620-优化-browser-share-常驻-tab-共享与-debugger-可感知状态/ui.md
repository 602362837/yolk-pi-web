# ui

## 是否需要 UI 设计员

不强制需要单独 UI 设计员。该需求主要是状态与安全文案增强，可沿用现有 `components/BrowserShareControl.tsx` 与扩展 popup 结构实施。若主会话决定加入页面内常驻 overlay，再建议 UI 设计员补充原型与页面侵入性评估。

## Chrome 插件 popup

### 主状态文案

- 无分享：`未共享任何 tab`。
- 创建中：`正在为当前 tab 开启常驻 Browser Share / Chrome debugger…`。
- 待绑定：`常驻分享已开启。当前无人可操作；请把分享码绑定到目标 ypi chat/session。`
- 已绑定 readonly：`已绑定到 ypi session <shortId>。Agent 可读取快照；所有操作都需要你在 ypi 中允许一次。`
- 已绑定 interactive：`已绑定到 ypi session <shortId>。click/scroll 可自动执行；type/navigate 仍需你在 ypi 中允许一次。`
- debugger 异常：`Chrome debugger 未连接，ypi 暂不可操作。请关闭 DevTools/其他调试器后重试，或停止分享。`
- 服务断开：`ypi 服务暂不可达；tab 仍处于本地共享/debugger 状态，但 agent 无法收到新操作。`

### Active Share 卡片字段

- `共享 tab`：title + url/origin。
- `可操作对象`：`尚未绑定 / ypi <baseUrl> · session <shortId>`。
- `权限模式`：readonly / interactive，并解释自动执行范围。
- `Debugger`：attached / attaching / detached / blocked / failed，附 attachedAt、detachReason、lastError。
- `服务地址`：activeShare 创建时固化 baseUrl，设置变化时提示“当前分享仍使用创建时地址”。
- `最近心跳`：lastPoll/lastHeartbeat/lastSnapshot。
- `最近命令`：type、结果、时间。
- 操作按钮：`停止分享并释放 debugger`、`刷新快照`、可选 `重试连接 debugger`。

## Chrome 浏览器可见信号

1. Chrome debugger infobar：由常驻 attach 自然触发，是主要持续安全提示。
2. 扩展 action badge（tab-scoped）：
   - `CODE` / amber：已共享但未绑定，无人可操作。
   - `YPI` / green：已绑定且 debugger attached。
   - `OFF` / gray：ypi 服务离线或心跳 stale。
   - `ERR` / red：debugger detached/blocked/failed。
3. action title tooltip：包含 tab 状态、baseUrl、session shortId、权限模式。

## ypi web `BrowserShareControl`

### Pill 文案

- 未绑定：`绑定浏览器分享`。
- 待插件/旧状态：`Browser Share：等待插件`。
- 已绑定且 attached：`Chrome 已共享：<title>`，绿色。
- 已绑定但 debugger 异常：`Chrome 共享异常`，红/橙色。
- 心跳 stale/offline：`Chrome 共享离线`，灰/橙色。

### 弹层新增“授权范围”区域

示例文案：

```text
可操作对象
当前 ypi chat/session：<session shortId>
服务：<baseUrl>
权限：readonly（所有操作需允许一次）
Debugger：常驻已连接，Chrome 顶部会显示调试提示
```

interactive 模式：

```text
权限：interactive（click/scroll 可由 agent 直接执行；type/navigate 仍需允许一次）
```

debugger 异常：

```text
Debugger 未连接。为避免不可感知操作，agent action tools 暂不会执行；请在 Chrome 插件中重试或重新分享。
```

## 非 MVP：页面内 overlay

默认不做持久 DOM overlay。原因：会修改用户页面 DOM、可能影响布局/点击、在跨域/受限页面不可用。若后续必须做，建议只做 Shadow DOM + `pointer-events: none` 的小角标，并提供关闭/不注入选项。
