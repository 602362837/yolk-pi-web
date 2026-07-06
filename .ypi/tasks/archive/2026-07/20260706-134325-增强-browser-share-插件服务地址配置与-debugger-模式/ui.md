# UI — Browser Share 服务地址配置与 debugger 模式

## 是否需要 UI 设计员

需要轻量 UI 设计，但不必单独做高保真原型。主要改动在 Chrome 扩展 popup，小范围改动 ypi web 的 `BrowserShareControl` 状态展示。

## 插件 popup 信息架构

建议把 popup 从单一操作面板拆成三个视觉区域：

1. **连接设置**
   - 标题：`蛋黄派服务地址`
   - 输入框：默认 `http://localhost:30141`
   - 操作：`保存并测试`、`重置为本机默认`
   - 状态：连接成功/失败、返回的 service/version/capabilities。
   - 提示：非 localhost 地址显示“请仅连接可信内网或受保护反代；ypi web 本身不是公网服务”。

2. **分享控制**
   - 现有 `允许操作（高风险仍需 ypi 确认）` 保留。
   - 新增实验项：`启用 Chrome debugger/CDP（实验）`。
   - 如果启用 debugger：显示权限/冲突提示；若当前插件构建不支持 debugger，显示“请加载 debugger build”。
   - 可选独立项：`允许截图上传给 ypi/agent`，默认关闭。
   - 操作按钮：`分享当前页`、`刷新快照`、`停止分享`。

3. **当前分享状态**
   - 当前 tab title/url。
   - 使用的 ypi 服务地址（创建该 share 时的 baseUrl）。
   - 权限模式：readonly/interactive。
   - 采集模式：DOM / debugger-CDP / fallback。
   - debugger 状态：未启用、attach 中、已 attach、attach 失败、已 detach。
   - 最近轮询、最近快照、最近命令。
   - 分享码与过期时间。

## 关键交互

### 保存服务地址

1. 用户输入 URL。
2. 点击 `保存并测试`。
3. 前端规范化：trim、去末尾 `/`、只允许 http/https、保留 path 前缀。
4. 非默认 origin：请求 Chrome host permission；用户拒绝则不保存或保存为 disabled 状态。
5. 调用 `${baseUrl}/api/browser-share/health`。
6. 成功后写入 `chrome.storage.local.baseUrl`，失败则显示可复制的错误。

### 地址切换与 active share

- 若存在 active share，UI 文案明确：“当前分享继续连接创建时的服务地址；新地址将在下次分享生效。”
- 更安全的实现：保存新地址时询问是否停止当前分享并重新生成分享码。

### debugger 启用

- checkbox 附带风险文案：Chrome 会显示调试提示；可能与 DevTools 冲突；可采集更多页面结构。
- 如果 attach 失败，popup 显示错误并自动降级 DOM 模式，不阻断普通分享。
- 停止分享时显示“已断开 debugger”。

## ypi web UI 小改动

`components/BrowserShareControl.tsx` 在已绑定状态中增加只读展示：

- `服务：<origin/path 或 host>`（可选，来自 share 创建时上报的 baseUrl/sourceOrigin）。
- `采集：DOM` / `CDP` / `CDP fallback`。
- `Debugger：已启用/失败/未启用` 与 lastError（短文本）。
- 如果截图能力启用，明确标记“截图可用/需确认”。

不在 ypi web 中配置插件地址；地址配置属于扩展自身，因为扩展是在不同 Chrome profile/机器上运行的客户端。
