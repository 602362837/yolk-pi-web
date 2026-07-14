# Design：SuperGrok OAuth、账号隔离与额度

## 1. 证据摘要

### pi-grok-cli 0.4.1

- 包入口只公开默认完整 extension factory（`src/index.ts -> src/provider/register.ts`），没有稳定的 provider-only、billing 或 refresh 子模块 export。
- `registerGrokCli()` 注册 `grok-cli`：`api=openai-responses`、静态 models、OAuth、per-model Grok version/token headers、`before_provider_headers` 的 `x-grok-conv-id=sessionId`、payload sanitizer、Cursor-style tools、Imagine、vision、usage command。
- OAuth：xAI OIDC discovery；仅接受 `x.ai` / `*.x.ai` HTTPS endpoint；PKCE；loopback 首选 `127.0.0.1:56122`、失败回退随机端口；device code；manual code；可选读取校验后的 `~/.grok/auth.json`；token 请求 30s；凭证 expiry 提前 120s；refresh token rotation。
- inference endpoint 默认 `https://cli-chat-proxy.grok.com/v1`。环境 token bypass 无 refresh。
- billing headers：Bearer token、`x-xai-token-auth: xai-grok-cli`。月接口 `/billing` 必须成功；周接口 `/billing?format=credits` 失败时忽略。
- 月字段：`config.monthlyLimit.val:number`、`config.used.val:number`、`config.billingPeriodEnd:ISO`；周字段：`config.currentPeriod.type`、`config.creditUsagePercent:number`、`config.billingPeriodEnd:ISO`。

### 当前 Web / Pi SDK

- 主会话 `lib/rpc-manager.ts` 自建 `DefaultResourceLoader`，只注入 Studio/Browser Share factories，再 `createAgentSession()`。
- Models API 走 `createAgentSessionServices()`，由其 loader 收集 provider registration 并应用到该 `ModelRegistry`。
- Studio child 走 `createAgentSessionServices({ resourceLoaderOptions.extensionFactories: [childGuard] })`。
- Auth routes 直接 `AuthStorage.create()`；它只看已注册 OAuth provider 的进程全局 registry，不主动加载 extension。
- `AuthStorage` 已提供 `auth.json` 文件锁、OAuth expiry 检查、refresh 锁和失败后 reload；`ModelRegistry` 保存实例级 registered provider，但 `refresh()` 会 reset pi-ai 全局 API/OAuth registry 后重放本实例 providers。
- 所以必须让**每一个可能 refresh 的 Web ModelRegistry**都拥有 Grok registration，并让 Auth API 显式 bootstrap provider；否则结果依赖路由/会话调用顺序。

## 2. 方案摘要

采用“上游扩展负责协议，Web 负责产品状态”的分层：

1. 固定依赖 `pi-grok-cli@0.4.1`，通过公开默认 factory 注入统一 Web resource-loader factory 列表。
2. 建立 `lib/pi-provider-extensions.ts`（建议名）作为唯一 provider extension 入口，供主会话、Models services、Studio child、Auth bootstrap 使用。
3. 将现有 OAuth saved-account 机制抽为 provider-adapter 架构；OpenAI 保持原 adapter，Grok 新 adapter 不伪造 ChatGPT accountId。
4. active account 仍 mirror 到 `auth.json`，但 Grok inference 增加 session-account binding 和请求时 account token resolver，解决并发串号。
5. 增加 Grok quota service，把不稳定上游 payload 转成 versioned、allowlisted Web wire schema，并实现 server cache/error degradation。

## 3. 模块与边界

### 3.1 Provider bootstrap

建议新增：

- `lib/pi-provider-extensions.ts`
  - 导出 named inline extension `{ name: "pi-grok-cli", factory: grokFactory }`。
  - 导出 `webProviderExtensionFactories(extra)`，稳定合并 Grok + 调用方 factories，避免各入口复制。
  - 不在模块 import 时启动 loader、网络或写凭证。
- `lib/pi-services.ts`（可选）
  - 包装 `createAgentSessionServices`，默认注入 provider factories。
  - Auth-only helper 可创建 services 并只消费 `authStorage/modelRegistry`，返回 diagnostics。

调用点：

- `rpc-manager.ts` 主 loader：Grok + Studio + Browser Share。
- `ypi-studio-child-session-runner.ts`：Grok + child guard。
- `app/api/models/route.ts`：Grok-aware services。
- OAuth providers/login/logout routes：先 bootstrap Grok provider，再使用同次 services 的 AuthStorage。
- 搜索所有 `ModelRegistry.create` / `createAgentSessionServices`；任何会 `refresh()` 的实例都必须包含 Grok provider registration。

**关键 invariant：** 不允许“裸 registry refresh”在同一进程最后 reset 掉 Grok 全局 provider。

### 3.2 能直接复用的扩展能力

- provider id/display name、静态模型目录和 thinking metadata；
- openai-responses 传输及模型必要 headers；
- payload sanitize、session conversation id；
- OAuth browser/device/manual/existing credential 流与 token refresh；
- xAI endpoint 校验、PKCE、timeout、refresh skew/rotation；
- 完整 factory 被批准时的 Cursor tools、vision、Imagine。

### 3.3 必须由 Web 适配的能力

- Provider 冷启动/bootstrap 与服务诊断；
- OAuth SSE 到 browser UI 的状态机；
- 多账号 sidecar、active mirror、账号备注/删除；
- session-account pinning 与 account-scoped refresh；
- billing fetch 的 Web API、缓存、stale/error/reauth projection；
- ModelsConfig 账号/额度 UI；
- secret redaction、权限、测试和文档。

`pi-grok-cli/src/provider/billing.ts` 没有公开 export。不得深路径 import；可在 Web adapter 中独立实现最小 HTTP/parse 契约，或推动上游公开 billing client 后再替换。OAuth refresh 则通过 provider 注册后取得的公开 Pi OAuth provider interface 调用，不复制 OAuth 源码。

## 4. 多账号数据契约

推荐把 `lib/oauth-accounts.ts` 拆成 generic store + provider adapters，保持 OpenAI wire 向后兼容。

目录：

```text
<agentDir>/auth-accounts/grok-cli/
  accounts.json               # 0600，无 secret
  <opaque-storage-id>.json    # 0600，完整 {type:"oauth", ...credential}
  deleted/...
```

metadata v1/v2 建议：

```ts
interface SavedOAuthAccountMetadata {
  accountId: string;          // opaque storage id，API 继续用 accountId 命名可兼容 UI
  provider: "grok-cli";
  label?: string;
  identityHint?: string;      // 仅安全投影，例如 email 掩码；不可为 token/fingerprint
  createdAt: string;
  updatedAt: string;
  lastActivatedAt?: string;
  quotaCache?: GrokQuotaCache;
}
```

- 不要求 Grok credential 存在真实 account id；`idToken` claim 只用于最佳努力 display hint，原始 id token 只在 secret 文件。
- 新增登录使用 `AuthStorage.inMemory()`，让 extension OAuth 完成后将 credential 提取到 saved store；只有用户选择 activate 时 mirror 到 file AuthStorage。
- 写 account secret、metadata、active mirror 需要 provider/account scoped mutation lock；跨文件事务顺序采用“先可恢复 secret -> metadata -> auth mirror”，失败时保留旧 active 指针并返回结构化错误。

## 5. 激活与 session isolation

### 5.1 推荐产品语义

- `activeAccountId` = **新 Grok 会话默认账号**。
- 每个 Grok session 保存非 secret `grokAccountStorageId` binding；恢复时继续使用它。
- fork 继承父会话 binding；Studio child 若使用 Grok，默认继承 parent binding，否则取创建时 active；具体继承字段应写入 child header 以便审计。
- 一个 session 改为非 Grok model 时保留 binding，切回 Grok 仍使用原账号，除非用户显式“此会话切换账号”。

### 5.2 请求 token 路径

仅 active mirror 不够。建议新增 account token resolver：

```ts
getGrokAccessToken(storageId, { minValidityMs, signal }): Promise<{
  accessToken: string;
  refreshed: boolean;
  expiresAt: number;
}>
```

- 读取绑定账号 secret；到期时通过注册后的 Pi `OAuthProviderInterface.refreshToken()` 刷新。
- 进程内 single-flight key=`grok-cli:storageId` + 文件锁，防多 session/多进程重复 refresh。
- refresh 后原子写回该 secret；若它仍是 active，再 compare-and-set 更新 `auth.json` mirror，避免旧 refresh 覆盖用户刚激活的新账号。
- inference 请求通过 Web 注入的 Grok adapter extension 在 `before_provider_headers` 覆盖 `Authorization` 为 session-bound token。必须保证只作用于 `ctx.model.provider === grok-cli`。
- 完整扩展内 vision/Imagine 不一定经过同一 request hook；若 v1 声明它们支持多账号隔离，需额外验证/适配，否则 UI/文档明确“主 inference 隔离，附加功能使用 active account”并将其列为限制。推荐在正式验收前解决，避免隐含串号。

删除账号前查询 session header bindings：有引用时返回 409 + bounded count；UI 要求取消、迁移引用或保留。不要静默改绑。

## 6. Quota API 与安全投影

建议沿用 REST 族但避免把 OpenAI quota shape 强塞给 Grok：

- `GET /api/auth/quota/grok-cli?accountId=<opaque>&refresh=1`
- `accountId` 省略时读取 active。
- 无 reset-credit POST；Grok route 对 POST 返回 405/明确 unsupported。

wire schema：

```ts
interface GrokQuotaResultV1 {
  kind: "grok_subscription_quota";
  schemaVersion: 1;
  success: boolean;
  provider: "grok-cli";
  accountId: string;
  monthly?: {
    limit: number;
    used: number;
    remaining: number;
    utilization: number;
    resetsAt: string;
  };
  weekly?: { usedPercent: number; resetsAt: string };
  cache: {
    state: "live" | "fresh" | "stale" | "none";
    queriedAt: string | null;
    ageMs: number | null;
  };
  reauthRequired: boolean;
  error?: { code: "network" | "rate_limited" | "unauthorized" | "upstream" | "invalid_payload"; message: string; retryable: boolean };
}
```

校验/归一化：

- 所有数字 finite；`limit >= 0`、`used >= 0`；remaining 用 `max(0, limit-used)`；utilization 在 UI 投影 clamp 0..100，但保留 over-limit 可用 additive flag（若需要）。
- ISO 日期 parse 成标准 ISO；拒绝 invalid。
- weekly 是 optional，单独失败不使 monthly 失败。
- 不返回 raw payload、上游 body、base URL、headers、credential、真实 filesystem path。

缓存：

- process cache + persisted metadata cache；fresh TTL 推荐 60s；stale max age 推荐 24h。
- single-flight key=`provider:accountId`，`refresh=1` 绕过 fresh，但加入已有 flight。
- fetch timeout 推荐 10s；月/周请求共享 account token但月优先。
- 401/403：强制 refresh 绑定 credential 一次，月请求 retry 一次；仍失败 `reauthRequired=true`。
- 429：若有 stale 返回 200 + stale/error；无 cache 返回 429 或统一 502 需 API 一致性决定，推荐保持业务结果 200 便于同一 UI state machine，同时 `success=false`。所有响应 `Cache-Control: no-store`。

## 7. API 与 UI 兼容

- `/api/auth/providers` 增加 `grok-cli`，可加 `authMode:"managed_accounts"`、`accountCount`、`activeAccountDisplayName`，但不能破坏旧字段。
- `/api/auth/accounts/[provider]` 泛化 allowlist 后为 Grok 提供 GET/PATCH/DELETE；POST credential import 若 v1 不批准则对 Grok 返回 unsupported，新增账号走 `login?...accountMode=add`。
- `/api/auth/login/grok-cli?accountMode=add` 使用 in-memory storage；普通 login 可直接保存并激活第一个账号。
- `ModelsConfig.OAuthDetail` 必须去掉 `provider.id === openai-codex` 才显示 accounts/quota 的硬编码，改用 capabilities 驱动；OpenAI reset-credit/warmup 仍保持专属。

## 8. 兼容性、风险、回滚

### 风险

1. **完整扩展范围扩大**：包只公开完整 factory。需用户批准附带工具/vision/Imagine，或等待上游 provider-only export。
2. **全局 registry reset**：任何裸 `ModelRegistry.refresh()` 可清除动态 registration。统一工厂 + 测试所有创建点。
3. **header override 脆弱**：需验证 Pi 0.80.6 `before_provider_headers` 顺序与 Authorization casing；不要 monkey-patch私有方法。
4. **附加功能串账号**：vision/Imagine 可能直接调用 registry active token；必须列测试/限制。
5. **第三方 backend 变化**：billing 是非公开 Grok Build endpoint；严格 parser、短缓存和 stale degradation。
6. **删除引用账号**：需要 session binding 索引/扫描策略，避免热路径全量扫描；删除操作可接受有界显式扫描或维护 sidecar index。

### 回滚

- 关闭统一 Grok extension factory 注入，隐藏 Grok UI/API；不删除 saved account sidecar。
- 清理 `auth.json["grok-cli"]` 仅在用户明确 disconnect 时进行。
- session header additive binding 被旧版本忽略。
- Quota cache 是非权威元数据，可停止读取而无需迁移。

## 9. 决策门禁

实现前必须确认：session pinning 语义、完整扩展范围、credential import、cache 默认值，并完成 HTML 原型审批。
