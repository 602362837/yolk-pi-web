# Brief：Grok 顶部用量小组件与开关

## 目标

为 `grok-cli` 增加一个与现有 GPT 用量入口位置和交互模式对称的顶部小组件，并允许用户在 Settings → Grok 独立控制是否显示。复用现有 Grok OAuth、账号激活和 quota API，不新增额度来源，不改动推理或自动切号语义。

## 现状证据

- GPT 顶部入口由 `components/ChatGptUsagePanel.tsx` 实现，`components/AppShell.tsx` 根据 `webConfig.chatgpt.usagePanelEnabled` 挂载在顶部右侧；设置写入 `~/.pi/agent/pi-web.json`。
- `components/SettingsConfig.tsx` 的 ChatGPT 分区已有“ChatGPT 用量悬浮面板”开关；`lib/pi-web-config.ts` 负责默认值、兼容读取、严格校验和 PATCH 合并。当前默认值是关闭。
- Grok 已有 Settings 分区与 `grok.autoFailover`，但 `PiWebGrokConfig` 尚无用量面板开关。
- `GET /api/auth/accounts/grok-cli` 可返回脱敏账号列表和全局 Active；`POST /api/auth/accounts/grok-cli/activate` 可切换 Active 并调用 `reloadRpcAuthState()`。
- `GET /api/auth/quota/grok-cli` 已支持 Active 账号，`?accountId=<opaque>` 支持指定账号，`?refresh=1` 强制刷新；POST 明确不支持 reset credit。
- `GrokQuotaResultV1` 只允许月度 `limit/used/remaining/utilization/resetsAt`、可选周额度、cache 状态、`reauthRequired` 和固定错误码。服务端已有 60 秒 fresh、24 小时 stale、single-flight、10 秒 timeout 与一次 401/403 强制刷新重试。
- `components/ModelsConfig.tsx` 已实现 `GrokQuotaView`，包含月/周额度、stale、reauth、错误和手动刷新表达；顶部组件应抽取复用该展示，而不是复制第二份 Grok quota 卡。

## 推荐方案

1. 在 `grok` 配置增加 `usagePanelEnabled: boolean`，**默认关闭**，与 GPT 一致，避免升级后自动占据顶部空间或触发额度请求。
2. 新增 `GrokUsagePanel`，复用 GPT 的顶部入口/展开面板模式，并复用从 Models 抽出的共享 `GrokQuotaView`。
3. AppShell 使用一个顶部 usage host 同时承载 GPT 与 Grok：顺序为 Session Stats → GPT（若开启）→ Grok（若开启）→ 右侧抽屉按钮；右侧安全留白只计算一次。
4. 展开面板展示 Active 账号、月/周额度、cache 新鲜度、手动刷新和 saved-account 快速 Activate；不加入 GPT 专属 reset credits、warmup 或后台 scheduler。
5. 挂载时读取；页面可见时每 30 秒轻量重验证（不带 `refresh=1`，优先命中服务端 60 秒 fresh cache）；重新聚焦/展开时重验证；手动刷新及切账号后带 `refresh=1`；隐藏页面不轮询。

## UI 门禁

任务新增顶部可见组件、展开交互和设置开关，已触发 UI HTML 原型硬门禁。已明确派发 UI 设计员，仅允许其产出任务目录 `ui.md` 与自包含 HTML 原型；用户批准原型和计划前不得实现。

## 待用户审批的推荐决策

- 默认关闭 `grok.usagePanelEnabled`。
- 顶部同时开启时 GPT 在前、Grok 在后。
- v1 展开面板提供快速 Activate，但只展示当前 Active/选中账号的完整 quota，避免自动对所有账号发起 N 次额度请求。
- 自动重验证为前台 30 秒；只有显式手动刷新或切号才绕过 60 秒服务端 fresh cache。
