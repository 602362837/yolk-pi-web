# PRD：SuperGrok OAuth 与多账号额度管理

## 目标与用户价值

让用户在 Yolk Pi Web 内使用 SuperGrok / X Premium 订阅完成 Grok OAuth 登录、选择 `grok-cli` 模型、保存和切换多个账号、查看每个账号的月/周额度，并保证并发 Grok 会话不会因另一个账号被激活而串用凭证。

## 范围内

- 固定集成 `pi-grok-cli@0.4.1` 的 `grok-cli` provider、OAuth 与模型目录。
- Browser PKCE、device code 和扩展支持的官方 Grok Build credential 复用入口。
- 多 OAuth 账号保存、列表、备注、激活、重新登录、删除。
- active 账号作为新 Grok 会话默认账号；已绑定会话保持账号隔离。
- 指定账号额度读取：monthly 必选，weekly 可选；缓存、手动刷新和错误降级。
- Grok provider 在主 Chat、Models API、Auth API、Studio SDK child session 中一致可用。
- 安全日志、错误投影、存储权限和回归测试。

## 范围外

- 绕过 xAI 套餐、地区、模型或额度限制。
- 将订阅 credits 换算成公共 API 金额；Pi 模型 cost 与 subscription quota 保持不同口径。
- v1 自动账号 failover、余额耗尽自动切号、跨设备云同步。
- 修改 `pi-grok-cli` 上游 OAuth/streaming 协议。
- 在未确认产品决策前支持原始 Grok credential JSON 导入。

## 功能需求与验收标准

### R1 Provider 与模型

- 安装/运行 Web 后，Models API 稳定列出 extension 注册的 `grok-cli` 模型，未登录时显示 provider 但模型可用性遵循 Pi auth 规则。
- 新建、恢复主会话及 Studio SDK 子会话选择 `grok-cli/<model>` 后均走 `pi-grok-cli` 注册的 endpoint、headers、payload sanitizer 和 OAuth。
- 不依赖先打开某个会话才能让 Auth/Models 页面识别 Grok。

### R2 OAuth 登录

- Web OAuth SSE 能呈现登录方式选择、auth URL、device code、进度、手工 code 和取消状态。
- add-account 登录不覆盖当前 active credential；成功后保存为独立 opaque storage id。
- `access`、`refresh`、id token、授权 code、callback URL 不得进入浏览器响应、前端状态日志、错误文本或账号 metadata。
- `GROK_CLI_OAUTH_TOKEN` 只能作为单一外部 token bypass，UI 明确“不可自动刷新且不纳入 saved-account 管理”。

### R3 多账号与激活

- 每次 OAuth 新增都产生独立 storage id；账号显示使用用户备注/安全 claim/掩码回退，不以 token 或 refresh fingerprint 作为 UI id。
- 激活事务更新 metadata active id、`auth.json["grok-cli"]` mirror，并让后续新会话/Models availability 使用该账号。
- 删除 active 账号必须显式选择替代账号，或确认断开 provider；不得留下指向缺失 secret 的 active id。
- 账号 secret 独立文件 `0600`、目录 `0700`；metadata 不含 credential。

### R4 并发会话隔离（推荐语义，待确认）

- Grok 会话首次建立/选择 Grok 模型时绑定 saved-account storage id，并持久化可恢复的非 secret 引用。
- active account 后续切换不改变已有会话的 account binding；新会话默认绑定新的 active account。
- 同一账号的并发 refresh 去重；不同账号独立 refresh。刷新后原子更新对应 secret，并仅更新仍绑定该账号的请求 token。
- 删除仍被活跃/可恢复会话引用的账号时，UI/API 必须阻止或要求显式迁移策略，不能静默回退到另一个账号。

### R5 额度

- 用户可按 saved-account id 查看月度 `limit / used / remaining / utilization / resetsAt`，以及存在时的周 `usedPercent / resetsAt`。
- 默认 60 秒 fresh cache；同账号并发读取 single-flight；手工刷新可 bypass fresh cache但仍复用同一进行中请求。
- 网络/5xx/429/周接口失败时，月额度若有不超过 24 小时的旧缓存则返回 `stale` 并展示最后更新时间；无缓存返回可重试错误。
- 401/403 先对该账号 refresh 一次并重试一次；仍失败则标记 `reauthRequired`，不删除凭证。
- HTTP 响应 `Cache-Control: no-store`；仅返回 allowlist 数字、ISO 时间、状态码枚举和清洗后消息。

### R6 可观察性与兼容

- Provider 注册错误、refresh 失败、billing 降级可诊断，但日志只含 provider、opaque account id、状态分类和时间，不含 secret/raw body。
- 现有 `openai-codex` saved accounts、API-key managed accounts、非 Grok providers 行为不变。
- 回滚扩展加载后，Grok saved-account sidecar 保留但不自动删除；其他 provider 可继续工作。

## UI 验收前置

必须由 UI 设计员提交 HTML 原型并获用户审批。原型至少覆盖：未连接、登录方式、登录进行中/取消/失败、多账号列表、active 与 session-pinned 提示、月/周额度、loading/fresh/stale/error/reauth、删除/迁移确认、移动端布局。

## 未决问题

- 确认 session pinning 语义。
- 确认完整扩展 vs 等待上游 provider-only export。
- 确认 v1 是否支持 credential JSON 导入。
- 确认 60 秒 fresh / 24 小时 stale 默认值。
