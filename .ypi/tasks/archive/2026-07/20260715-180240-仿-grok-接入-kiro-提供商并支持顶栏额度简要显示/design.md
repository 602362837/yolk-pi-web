# Design：Kiro provider、多账号额度、自动切号与顶部简要模式

## 方案摘要

采用“**统一 provider bootstrap + 复用通用 OAuth store + Kiro 独立 quota/token/failover + 共享 topbar trigger 原语**”方案：

- `pi-kiro-provider` 与 `pi-grok-cli` 都由 `jiti` 在 Node runtime异步加载，统一进入每个 Web ResourceLoader / ModelRegistry入口。
- OAuth文件布局与 lifecycle复用 `oauth-accounts.ts`，新增 Kiro adapter；provider-specific token refresh和 quota放在独立模块。
- Kiro额度直接调用 AWS CodeWhisperer `GetUsageLimits`，严格白名单解析；不依赖 package私有文件，不用 per-turn metering冒充额度。
- Kiro failover是第四条独立 Path B controller，外层顺序为 Kiro → Grok → OpenCode Go → ChatGPT → Pi native。
- GPT/Grok/Kiro详细面板保持 provider-specific，仅抽一个纯展示的 topbar trigger/额度摘要原语来保证全局简要模式一致。

## 影响模块与边界

| 区域 | 主要文件 | 设计边界 |
| --- | --- | --- |
| 依赖/加载 | `package.json`, lockfile, `next.config.ts`, `lib/pi-provider-extensions.ts` | 只使用 package公开 default factory；jiti + external |
| Bootstrap consumers | `lib/rpc-manager.ts`, `lib/ypi-studio-child-session-runner.ts`, Models/Auth/Skills/Commands/assist routes | 所有 provider入口统一；不能只修主 Chat |
| OAuth store | `lib/oauth-account-providers.ts`, `lib/oauth-accounts.ts`, auth accounts/login/activate routes | 通用 store不硬编码 Kiro UI；secret不出服务端 |
| Kiro token/quota | 新增 `lib/kiro-account-token.ts`, `lib/kiro-subscription-quota.ts` | 不导入 npm包私有路径；不返回 raw payload |
| Failover | 新增 `lib/kiro-account-failover.ts`, `lib/rpc-manager.ts`, `hooks/useAgentSession.ts`, Chat UI | 独立 controller；不改 GPT/Grok classifier |
| Models | `components/ModelsConfig.tsx`, 新增 `components/KiroQuotaView.tsx` | Kiro账号/额度；不伪造 reset credit |
| Topbar | 新增共享 trigger helper/component、`ChatGptUsagePanel.tsx`, `GrokUsagePanel.tsx`, 新增 `KiroUsagePanel.tsx`, `AppShell.tsx`, CSS | 共享 trigger壳，不合并 provider数据状态机 |
| Config | `lib/pi-web-config.ts`, `app/api/web-config/route.ts`, `components/SettingsConfig.tsx` | 全局 compact + Kiro panel/failover；默认均 off/false |
| Docs/tests | integration/API/frontend/library docs，provider/account/quota/failover/panel tests | 保留现有测试并增加 Kiro契约 |

## Provider bootstrap

### 新结构

```text
webProviderExtensions()
  ├─ grokCliExtension        jiti.import("pi-grok-cli")
  └─ kiroProviderExtension   jiti.import("pi-kiro-provider")

webExtensionFactories(extra)
  └─ [...webProviderExtensions(), ...extra]
```

新增泛化 API：

- `ensureWebProvidersBootstrapped()`：process one-shot promise，创建一次 throwaway services加载所有固定 provider。
- `createWebProviderAwareModelRegistry()`：bootstrap后调用 bare `ModelRegistry.create()`。

旧 `ensureGrokBootstrapped` / `createGrokAwareModelRegistry` 可以暂留 deprecated alias，所有项目 call site和测试在本任务迁到泛化命名。单个 assist/skills/commands route不再直接传 `[grokCliExtension]`，统一使用 provider factory列表，避免 Kiro漏接。

加载失败按 provider隔离并保留诊断；其他 provider可继续启动。`next.config.ts.serverExternalPackages` 同时包含 `jiti`、`pi-grok-cli`、`pi-kiro-provider`。

## OAuth 多账号设计

### Kiro adapter

```ts
const KIRO_PROVIDER_ID = "kiro";
```

Credential验证：必须有非空 `access`、`refresh` 和 finite `expires`；允许并原样保留 `clientId/clientSecret/region/profileArn/authMethod/provider/request` 等上游字段。

- provider-native id：`sha256(refresh)` 截断并加 `kiro-` 前缀，仅用于 metadata/诊断；文件名仍用随机 opaque storage id。
- display hint优先：可安全解析的 JWT email/name → `provider/authMethod` → masked id；完整 profile ARN不作为浏览器 display。
- `supportsCredentialImport=false`，只能 OAuth新增。
- active mirror继续走通用 `activateOAuthAccount()`；`auth.json`需要时补 `type:"oauth"`，secret文件保存原始 Kiro shape。

### 文件布局

```text
~/.pi/agent/auth-accounts/kiro/
  accounts.json             # 0600 metadata only
  <opaque-id>.json          # 0600 OAuth credential
  .quota-cache.json         # 0600 normalized quota only
  deleted/
```

### Token refresh

`kiro-account-token.ts` 对齐 Grok：

- per-account process single-flight + file-level lock；
- `getOAuthApiKey("kiro", ...)` 调用已注册 provider refresh；
- 支持 `forceRefresh:true`；
- tmp+rename + 0600原子回写；
- active mirror compare-and-set：刷新结束时仍是 Active才写 `auth.json`；
- 不记录 access/refresh/clientSecret/profileArn。

## Kiro quota设计

### 上游请求

```http
POST https://q.<validated-region>.amazonaws.com/
Authorization: Bearer <access>
Content-Type: application/x-amz-json-1.0
Accept: application/x-amz-json-1.0
X-Amz-Target: AmazonCodeWhispererService.GetUsageLimits
```

主请求 body：

```json
{
  "origin": "AI_EDITOR",
  "resourceType": "CREDIT",
  "isEmailRequired": false,
  "profileArn": "<仅凭据存在时>"
}
```

- region来自凭据或 `us-east-1`；必须通过严格 AWS commercial-region格式/allowlist，再由代码拼接固定 `q.<region>.amazonaws.com`，绝不接受 credential中的任意 URL。
- 仅当主 body得到官方 `ValidationException` 时，允许一次最小 fallback body（`profileArn`若存在，否则 `{}`）；禁止多轮猜测和 UI scraping。
- timeout 10s；401 force refresh后重试一次；429映射 rate_limited；403映射 access_denied/reauth安全状态但不把 raw body透传。

### 安全 wire contract

```ts
interface KiroQuotaResultV1 {
  kind: "kiro_subscription_quota";
  schemaVersion: 1;
  provider: "kiro";
  accountId: string; // opaque storage id
  success: boolean;
  subscription?: { title?: string };
  buckets: Array<{
    id: string;
    label: string;
    resourceType?: "CREDIT" | "VIBE" | "SPEC" | "AGENTIC_REQUEST" | "OTHER";
    used: number;
    limit: number;
    remaining: number;
    utilization: number;
    unit?: string;
    resetsAt?: string;
  }>;
  primaryBucketId?: string;
  cache: { state: "live" | "fresh" | "stale" | "none"; queriedAt: string | null; ageMs: number | null };
  reauthRequired: boolean;
  error?: { code: "network" | "rate_limited" | "unauthorized" | "access_denied" | "upstream" | "invalid_payload" | "unsupported_region"; message: string; retryable: boolean };
}
```

Parser规则：

- `usageBreakdownList`优先，fallback到单个 `usageBreakdown`；最多保留固定数量 bucket。
- `currentUsageWithPrecision/usageLimitWithPrecision`优先，fallback整数；只接受 finite non-negative；`limit<=0`按 unknown/unlimited policy处理，不计算 0%假值。
- label/unit/subscription title需 trim、长度上限和 allowlist；不返回 `userInfo`、email、overage raw、currency raw、free-trial raw、request id。
- primary优先 `resourceType=CREDIT`，其次第一个可计算 bucket；topbar与 failover使用同一 primary。
- 60s fresh / 24h stale、per-account single-flight；缓存只存 normalization后的 wire-safe数据。

API复用 `GET /api/auth/quota/[provider]` 的 Kiro分支；POST明确返回 405。所有 Kiro响应 `Cache-Control:no-store`。

## 自动切号设计

### Classifier allowlist

正例：

- structured reason/code：`MONTHLY_REQUEST_COUNT`、`OVERAGE_REQUEST_LIMIT_EXCEEDED`、`CONVERSATION_LIMIT_EXCEEDED`、`DAILY_REQUEST_COUNT`、`ServiceQuotaExceededError`；
- `authFailure.reason === "quota_or_entitlement"` 且不是认证子类；
- 明确 `quota exceeded/exhausted`、`monthly usage limit reached`、`too many requests` / `rate_limit_exceeded` 文案。

硬负例优先：

- `INSUFFICIENT_MODEL_CAPACITY`、bare 429/403/status；
- unauthorized/token expired/invalid grant/reauth；
- network/fetch/socket、timeout/deadline；
- 500/502/503/504；
- context window、content/safety、model unavailable/not found；
- 文档/帮助式模糊文本。

### Controller

`globalThis.__piKiroFailover` 只保存 lock、cooldown map、lastSwitchAt；每 wrapper turn创建 `{attempts:0,switches:0}`。

流程：

1. 检查 provider=`kiro`、开关、classifier、预算。
2. snapshot trigger Active；进入 process lock。
3. 标记 trigger account cooldown；lock后重读 Active。
4. 若 Active已被其他 Session切换，复用新 Active并 retry一次。
5. 循环候选账号：credential可读/可刷新、fresh/live quota成功、primary remaining>0、无需 reauth；unknown/stale fail-closed。
6. Activate前再次检查 Active；成功后 `reloadRpcAuthState()`，预算+1，同 turn retry。
7. 无候选/失败不重试。

RPC patch添加在 Grok外层，使 provider不匹配时完全 passthrough。Kiro事件和前端 notice不得包含账号 id，即使 controller内部结果为了测试包含 id，SSE emitter也要显式安全投影。

## 顶部简要模式

### 配置

```ts
usage.providerPanelsCompact: boolean // default false
kiro.usagePanelEnabled: boolean      // default false
kiro.autoFailover.enabled: boolean   // default false
```

全局 compact放在 Settings → Usage；Kiro开关放在 Settings → Kiro。旧 `pi-web.json` 缺字段时按默认值补 projection，不回写直到用户保存。

### 共享 trigger，不共享业务状态

新增纯展示 `ProviderUsageTrigger`（命名可调整），props包含：

- provider label、open、loading/tone；
- `displayMode: "full" | "compact"`；
- full模式 status + ring items；
- compact模式最多两个 `{label,value,title}` quota摘要；
- unknown/login/reauth短 fallback；
- button ARIA和 click。

GPT、Grok、Kiro继续各自加载 accounts/quota、管理 detailed popover和错误语义。这样避免把 GPT 5h/7d、Grok monthly/weekly、Kiro动态 buckets强转为一个 schema。

推荐简要文案：

- GPT：`GPT 5h 42% · 周 18%`
- Grok：`Grok 月 63% · 周 12%`
- Kiro：`Kiro 剩余 320 Credit`（或 `Kiro 38%`，以 HTML原型审批为准）
- 无账号：`Kiro 登录`
- reauth：`Kiro 需登录`
- unknown：`Kiro 额度未知`

简要 trigger仍打开原详细 panel。Topbar host单一、顺序 GPT→Grok→Kiro、right padding只计算一次。

## Models / Settings UI

- `OAuthDetail`将 Grok-only managed account分支扩成 provider-capability-driven的 OAuth saved-account UI；Kiro显示三种登录方法。
- Kiro quota view展示 subscription、primary与其他 buckets、fresh/stale/error/reauth、手动刷新；不显示 Reset credits。
- Kiro账号文案明确“全局 Active，影响普通 live/new Session后续请求；手动 Active不是自动轮换锁”。
- Settings新增 Kiro section；全局 compact开关不重复出现在三个 provider section。Kiro section 必须完全对齐 Grok/ChatGPT 拥有的左导航分节并列显示风格，保持视觉、描述结构和操作的对称性。

## 兼容性与迁移

- 无 Session JSONL迁移；不新增 Kiro session pin。
- OAuth store metadata version保持可读旧数据；Kiro为新 provider目录。
- config字段 additive，默认值保持现有 UI：GPT/Grok trigger完整态，Kiro隐藏，Kiro failover关闭。
- cacheWrite规则不变；Kiro upstream usage token中的 cacheWrite仍由现有 ledger normalize归零。
- package v0.2.2只通过公开 default export加载。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| Registry refresh丢 Kiro | 泛化 bootstrap + 全 call site审计 + cold-start test |
| TS源码被 Turbopack打包 | jiti async + serverExternalPackages + provider smoke test |
| Builder/social credential shape不同 | adapter fixture覆盖两类；保留未知上游字段但不出浏览器 |
| quota endpoint/schema变化 | 官方 target + strict allowlist parser + stale fallback + unavailable降级 |
| 403混淆 quota与 auth | quota query只安全分类；failover classifier硬负例先行 |
| 模型容量不足触发切号 | 明确拒绝 `INSUFFICIENT_MODEL_CAPACITY` 和 bare 429 |
| 并发 Session级联切号 | lock + Active double-check + TOCTOU + per-turn预算 |
| compact数字跨账号闪回 | request generation/Abort/accountId匹配；provider state不合并 |
| 三 provider UI大重构 | 只抽 trigger展示原语，不合并 detail panel/业务 schema |

## 回滚

1. 运维止血：关闭 `kiro.usagePanelEnabled`、`kiro.autoFailover.enabled`；compact可恢复 false。
2. Provider层回滚：从 `webProviderExtensions()`移除 Kiro并隐藏 UI/API分支；Grok继续工作。
3. 保留 `auth-accounts/kiro/` 与 normalized quota cache，不删除用户凭据。
4. 不回写历史 Session/ledger，因此无需数据迁移回滚。
