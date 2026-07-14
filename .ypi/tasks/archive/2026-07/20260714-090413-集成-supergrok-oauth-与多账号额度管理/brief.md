# Brief：集成 SuperGrok OAuth 与多账号额度管理

## 背景与目标

在 Yolk Pi Web 中将 `pi-grok-cli@0.4.1` 的 `grok-cli`（SuperGrok / X Premium 订阅）接入现有 Pi SDK 会话、模型选择和 OAuth 登录路径，并补齐 Web 所需的多账号保存、激活、按账号额度读取与并发会话隔离。

## 调查结论

- 当前依赖为 `@earendil-works/pi-coding-agent@^0.80.6` / `@earendil-works/pi-ai@^0.80.6`；`pi-grok-cli@0.4.1` peer 要求 `>=0.80.0`，版本兼容。
- `pi-grok-cli` 通过扩展工厂调用 `pi.registerProvider("grok-cli", ...)`，注册静态模型目录、`openai-responses` API、OAuth、必需请求头、payload 清洗、会话 conversation id 以及 Grok 工具兼容层。它不是 `models.json` 静态配置可等价替代的 provider。
- OAuth 支持 OIDC discovery、PKCE 浏览器回调、device code、手工 code、官方 `~/.grok/auth.json` 只读复用及 refresh；凭证为 `access / refresh / expires`，另带 token endpoint、id token、base URL 等扩展字段。环境变量 `GROK_CLI_OAUTH_TOKEN` 不可自动刷新。
- billing 月度字段为 `config.monthlyLimit.val`、`config.used.val`、`config.billingPeriodEnd`；周额度为 credits 响应的 `config.currentPeriod.type === USAGE_PERIOD_TYPE_WEEKLY`、`config.creditUsagePercent`、`config.billingPeriodEnd`。月度失败是整体失败，周额度失败仅降级为缺省。
- 扩展的 `/grok-cli-usage` 每次实时读取、不缓存，只面向 Pi TUI 通知；不能直接作为 Web API/UI 契约。
- Web 主会话手工创建 `DefaultResourceLoader`，Models API 使用 `createAgentSessionServices()`，auth routes 多数直接 `AuthStorage.create()`。动态 OAuth/provider 只有在扩展被 loader 加载并应用到对应 `ModelRegistry` 后才可靠存在，不能依赖“某个会话之前碰巧加载过扩展”的进程全局副作用。
- 当前 `lib/oauth-accounts.ts` 的存储、字段和接口均硬编码 `openai-codex`/ChatGPT，不能只扩 allowlist；可复用其 opaque storage id、secret/metadata 分离、权限和 active mirror 思路，但应抽取 provider adapter，而不是给 Grok 填充伪 ChatGPT 字段。
- 单一 `auth.json["grok-cli"]` 激活凭证只能表达全局 active account。若所有活跃会话每次都读它，账号切换会让并发会话串号，因此“并发会话隔离”需要明确的 session-account pinning，不能仅调用 `reloadRpcAuthState()`。

## 推荐边界

1. 直接依赖并加载 `pi-grok-cli@0.4.1`，复用其 provider/OAuth/模型/请求适配，不复制协议实现。
2. Web 增加统一 Grok-aware service/resource-loader 入口，确保主会话、Studio SDK 子会话、Models API 和 Auth API 使用同一 provider 注册路径。
3. Web 抽取通用 OAuth saved-account store + Grok adapter，保存多个完整 credential；active credential 继续镜像到 `auth.json` 以兼容 Pi 模型可用性和新会话默认值。
4. 推荐现有会话按 saved-account storage id 固定账号；active 切换只改变新会话默认账号。请求前按 pin 获取/刷新账号 token，避免活跃会话互相切换。
5. Web 自建额度 service/API：短 TTL、single-flight、stale-on-error、一次 401 refresh+retry、严格安全投影；不向浏览器返回 token、原始 billing payload 或 endpoint 错误正文。

## UI 门禁

本任务改变登录、账号管理、激活语义、会话账号归属和额度展示，**触发 UI HTML 原型硬门禁**。主会话必须派发 UI 设计员，基于现有 `ModelsConfig` OAuth 详情产出任务目录内 `.html` 原型并由用户审批后，才能进入实现。

## 需要主会话 / 用户决策

1. 是否确认“激活影响新会话，已开始的 Grok 会话保持账号固定”的推荐语义？如果要求激活立即切换所有会话，则与并发隔离目标冲突，需要明确牺牲项。
2. v1 是否加载 `pi-grok-cli` 的完整能力（Cursor 工具、vision、Imagine、usage command），还是只允许 provider 核心？该包只公开默认完整扩展，provider-only 不是公开 API；推荐 v1 加载完整受信扩展并在 Web 文档中声明附带能力，若产品不接受则需推动上游导出 provider-only factory，避免复制源码。
3. Grok saved account 是否仅支持 OAuth 登录新增（推荐 v1），还是同时要求原始 credential JSON 导入？
4. 额度刷新 TTL / stale 窗口是否接受推荐值：fresh 60 秒、错误时最多展示 24 小时旧缓存？
