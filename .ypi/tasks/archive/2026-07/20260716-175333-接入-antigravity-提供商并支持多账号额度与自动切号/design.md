# Design：Antigravity provider、多账号quota与自动切号

## 方案摘要

采用“**固定provider bootstrap + 通用opaque OAuth store + Antigravity独立lock/token/quota/failover + 共享N-ring/aggregate展示**”方案：

- `@yofriadi/pi-antigravity-oauth@0.3.0`只通过公开default extension加载，加入现有Grok/Kiro固定provider列表。
- OAuth存储复用`oauth-accounts.ts`；provider-specific credential验证、refresh/Activate锁和quota在独立模块中实现。
- Quota调用固定`fetchAvailableModels` endpoint，按模型投影`remainingFraction/resetTime`，不依赖rotator运行时、不接受任意URL。
- 自动切号为独立Path B controller，model-aware且fail-closed。
- 顶栏扩展现有Full/Compact/Aggregate合同；不制造跨模型或跨provider总额。

## 影响模块与边界

| 区域 | 主要文件 | 边界 |
| --- | --- | --- |
| 依赖/加载 | `package.json`, `package-lock.json`, `next.config.ts`, `lib/pi-provider-extensions.ts` | jiti/public default factory；callback固定loopback |
| Bootstrap consumers | `lib/rpc-manager.ts`, Studio child、Models/Auth/Skills/Commands/assist/model-price routes | 全入口审计；单provider失败隔离 |
| OAuth store | `lib/oauth-account-providers.ts`, `lib/oauth-accounts.ts`, Auth routes | opaque id；projectId只在secret文件 |
| Refresh协调 | 新增`lib/antigravity-account-lock.ts`, `lib/antigravity-account-token.ts` | refresh/Activate共享锁；active mirror CAS |
| Quota | 新增`lib/antigravity-subscription-quota.ts`, `lib/antigravity-model-quota.ts`, quota route | 固定host/body/header；strict bounded parser |
| Failover | 新增`lib/antigravity-account-failover.ts`, `lib/rpc-manager.ts`, hook/Chat notice | 独立Path B；model-aware；安全SSE |
| Config | `lib/pi-web-config.ts`, web-config route, `SettingsConfig.tsx` | panel/failover默认off；全局compact/aggregate不复制 |
| Models | `ModelsConfig.tsx`, 新增`AntigravityQuotaView.tsx` | 登录/账号/quota；无JSON import/raw error |
| Topbar | 新增`AntigravityUsagePanel.tsx`, `antigravity-usage-ring.ts`, AppShell/contract/CSS | 第四provider；detail-only安全降级 |
| 文档测试 | AGENTS与docs、scripts/package scripts | provider/account/quota/failover/UI/privacy回归 |

## Provider bootstrap与callback安全

### 固定扩展列表

```text
webProviderExtensions()
  ├─ grokCliExtension
  ├─ kiroProviderExtension
  └─ antigravityProviderExtension
```

加载顺序固定为Grok → Kiro → Antigravity → call-site extras。`webExtensionFactories()`、`ensureWebProvidersBootstrapped()`、`createWebProviderAwareModelRegistry()`现有consumer自动获得第三个provider，但实现仍需用source-contract test审计所有ResourceLoader/createAgentSessionServices/ModelRegistry入口。

### jiti加载

```ts
createJiti(import.meta.url, { interopDefault: true })
  .import("@yofriadi/pi-antigravity-oauth")
```

- 只调用default factory；不import`src/index.ts`或其他私有模块。
- `serverExternalPackages`加入包名；其transitive `@google/genai`由Node运行时解析。
- 单provider加载异常catch隔离，不能阻断其他provider。

### 强制loopback

上游模块在import时读取`PI_OAUTH_CALLBACK_HOST`。因此Antigravity factory必须在首次jiti import前确保该值为`127.0.0.1`，且不得接受非loopback配置扩大监听面。实现建议使用一次性provider loader临界区：

1. 记录原环境值；
2. 在首次Antigravity import前设置`PI_OAUTH_CALLBACK_HOST=127.0.0.1`；
3. jiti import完成后模块常量已捕获loopback，可恢复原值；
4. loader使用process single-flight，避免并发import观察到不一致；
5. 测试实际监听地址或抽取可测的host policy，不能只检查字符串。

远程Web用户访问Google回调的`localhost`不一定指向服务器；现有SSE UI继续允许复制浏览器地址栏redirect URL并手工提交，作为受支持降级。

## OAuth多账号设计

### Adapter

```ts
export const ANTIGRAVITY_PROVIDER_ID = "google-antigravity";
```

Credential验证：

- `access`、`refresh`、`projectId`为非空字符串；
- `expires`为finite number；
- 可保留`email`和未来未知上游字段在secret文件，但adapter display只允许安全email/name；
- `deriveRealAccountId = antigravity-${sha256(refresh).slice(0,16)}`，metadata不保存projectId；
- `supportsCredentialImport=false`。

### 文件布局

```text
~/.pi/agent/auth-accounts/google-antigravity/
  accounts.json                    # 0600，metadata only
  <opaque-storage-id>.json         # 0600，access/refresh/projectId
  .quota-cache.json                # 0600，normalized safe quota only
  provider.refresh-activate.lock/  # mkdir lock
  deleted/
```

### Lock / token refresh

Antigravity复制Kiro已验证的跨进程协调语义，但保持provider独立：

- `globalThis`/module process mutex + mkdir owner lock，stale recovery与bounded wait；
- Activate在`oauth-accounts.ts`按provider进入`withAntigravityProviderLock()`；
- token resolver按opaque storage id single-flight；
- `getOAuthApiKey("google-antigravity", credential)`返回JSON API key，但resolver只向quota client返回解析后的access token，projectId从同一server-side credential读取；
- refresh结果与原credential merge，防止上游未回传projectId时丢失；
- tmp+rename、0600；
- 锁内重读Active并CAS mirror，非Active refresh不写`auth.json`。

所有refresh/token exchange异常在API边界映射为固定code/message；禁止把上游response text写入SSE/DOM/log。

## Quota设计

### 固定请求

```http
POST https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels
Authorization: Bearer <access>
Content-Type: application/json
Accept: application/json
User-Agent: antigravity/<fixed-compatible-version> darwin/arm64

{"project":"<server-only projectId>"}
```

首版不做endpoint fallback，避免猜测未验证host。host、path、UA由代码常量生成；credential不得提供URL、headers、UA或body扩展。timeout 10s。

### Wire contract

```ts
interface AntigravityQuotaModelWindow {
  id: string;                 // bounded safe quota model key or stable Web id
  label: string;              // bounded catalog-derived label
  publicModelIds: string[];   // allowlisted package catalog ids，bounded
  remainingFraction: number;  // 0..1
  usedPercent: number;        // (1 - remainingFraction) * 100
  resetsAt?: string;
}

interface AntigravityQuotaResultV1 {
  kind: "antigravity_subscription_quota";
  schemaVersion: 1;
  provider: "google-antigravity";
  accountId: string;          // opaque storage id
  success: boolean;
  models: AntigravityQuotaModelWindow[];
  cache: { state: "live" | "fresh" | "stale" | "none"; queriedAt: string | null; ageMs: number | null };
  reauthRequired: boolean;
  error?: {
    code: "network" | "rate_limited" | "unauthorized" | "access_denied" | "invalid_project" | "upstream" | "invalid_payload";
    message: string;          // fixed safe code/message only
    retryable: boolean;
  };
}
```

### Parser

- `models`必须为record；最多保留固定数量（建议64）并限制key/label/publicModelIds长度。
- 只读取`quotaInfo.remainingFraction`、`quotaInfo.resetTime`；其他字段丢弃。
- `remainingFraction`必须finite且`0 <= x <= 1`；不clamp越界raw数据，直接拒绝该entry。
- `usedPercent=100*(1-x)`后才可clamp浮点误差。
- `resetTime`只接受可解析的未来/合法ISO并标准化；无reset仍可显示remaining。
- 0个有效entry视为invalid/unavailable，不能success+空数组。
- cache只持久化上述normalized fields，60s fresh/24h stale，per-account single-flight。
- 401 force-refresh后仅retry一次；403分类`access_denied/invalid_project`，不自动当reauth。
- HTTP/body/raw headers/request id/endpoint/projectId不进入wire或日志。

### Model-aware映射

`@yofriadi/pi-antigravity-oauth@0.3.0`公开model id与请求/quota key存在差异。Web不运行时import私有mapping，新增固定compat表：

```text
public model id -> accepted quota model keys[]
```

要求：

- 以已审计`0.3.0` model catalog/routing为唯一来源；
- contract test逐个覆盖包catalog中的model；未映射模型显式标记unsupported-for-failover；
- quota UI可显示所有安全entry，但failover只接受当前模型映射集合命中的entry；
- 不用“任意模型还有额度”证明当前模型可用；
- exact默认project值不构成健康证据，live匹配entry才构成candidate证据。

## Topbar投影

Antigravity quota是按模型窗口，不存在可靠跨模型总额度。`lib/antigravity-usage-ring.ts`遵守共享contract：

1. 将有效模型quota去重为安全窗口候选；percent使用`usedPercent`。
2. `resetTime`仅进入title/detail，不作为`durationMs`或`durationEvidence`。
3. 只有一个安全候选时，共享projector允许单ring（duration未知可接受）。
4. 多候选且无可信duration时，projector返回detail-only / `ringUnit=null`；trigger fallback为固定“多模型”或“详情”。
5. 不按model id、对象顺序、remaining、percent、resetTime排序，不求和/平均/最小/最大冒充整体额度。
6. Aggregate risk可取已投影模型中的最高风险作为状态通道，但title必须明确“模型额度详情”，不能显示成总百分比。

`ProviderUsageKey`/aggregate label/order扩展Antigravity；建议order为GPT 0、Grok 1、Kiro 2、Antigravity 3。Aggregate shell仍不fetch quota，provider panel是唯一数据owner。

## 自动切号设计

### Classifier

正例必须含明确语义：

- structured/body text：`RESOURCE_EXHAUSTED`、`quota_exhausted`、`quota exceeded/exhausted`、`quotaResetDelay`、`quotaResetTimeStamp`；
- `rate_limit_exceeded`、`too many requests`、明确`rate limit`；
- 可带429，但429本身不能单独成为正例。

硬负例优先：

- 裸429或仅`Cloud Code Assist API error (429)`；
- 401/403、invalid/expired token、invalid grant、reauth、missing/invalid project；
- network/fetch/socket、timeout/deadline、abort；
- 500/502/503/504/529、overloaded、model capacity；
- context window、content/safety、model unavailable/not found；
- help/documentation/fuzzy文本。

### Controller

新增`globalThis.__piAntigravityFailover`，只保存lock、cooldown与lastSwitchAt。建议外层链：

```text
Antigravity → Kiro → Grok → OpenCode Go → ChatGPT → Pi native
```

流程：

1. provider/model匹配、配置enabled、classifier命中、budget可用。
2. snapshot trigger Active和当前public model id。
3. 进入process lock，标记trigger cooldown，重读Active。
4. Active已由其他Session切换：在新Active对当前模型仍有fresh/live可用quota时retry；否则terminal fail-closed。
5. 按账号稳定循环选择候选：credential有效、非trigger、非cooldown、quota fresh/live、非reauth、当前模型映射entry `remainingFraction > 0`。
6. Activate前再次重读Active防TOCTOU；成功Activate + `reloadRpcAuthState()`，budget加一并retry。
7. 无candidate、quota unknown、mapping unknown或异常均不retry。

RPC SSE只投影allowlist字段。`result`内部可含opaque account id供测试，但emitter必须手工挑选`status/reason/provider/retry/message`。

## UI与配置

```ts
antigravity.usagePanelEnabled: boolean        // default false
antigravity.autoFailover.enabled: boolean     // default false
```

预算、cooldown、新鲜度字段对齐Kiro/Grok，使用独立类型与validator。`usage.providerPanelsCompact/Aggregated`保持全局，旧值不迁移；Settings文案从“三provider”扩为包含Antigravity。

Models中的capability判断从`isGrok || isKiro`扩展为managed OAuth provider能力，避免再复制一棵UI：

- global Active semantics、protected delete、no import、single Google OAuth入口；
- Antigravity quota state独立，不能复用Kiro/Grok wire；
- login SSE对Antigravity错误做固定脱敏；
- account切换时abort旧请求、递增generation、清空旧quota。

最终视觉以UI设计员HTML原型与用户审批为准。

## 安全风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 非官方Cloud Code通道变化/封禁 | 固定版本、默认关闭可选功能、明确风险、快速隐藏provider回滚 |
| 宽`cloud-platform` scope | Models登录前可见风险说明；不额外请求scope；不记录token |
| 硬编码IDE client/模拟UA | 固定包版本与UA；不允许用户注入headers；文档披露 |
| callback绑定全网卡 | import前强制127.0.0.1 + listener测试 |
| default project假健康 | candidate必须live匹配当前模型quota；projectId不出server |
| refresh/token exchange raw body泄漏 | 固定错误码/文案；SSE/API/log禁用raw error |
| model key不匹配导致盲切 | 0.3.0固定映射contract；未知模型fail-closed |
| quota多模型被错误聚合 | detail-only；无总百分比；resetTime不参与N-ring排序 |
| 并发级联切号 | lock + trigger snapshot + Active双检查 + model-aware复验 + turn预算 |
| provider加载破坏Grok/Kiro | per-provider隔离 + cold bootstrap/all-callsite tests |

## 兼容、迁移与回滚

- 无Session JSONL、Usage ledger、模型价格或cacheWrite迁移。
- config additive；缺字段时panel/failover关闭。
- account store新目录，不改Grok/Kiro目录。
- 止血：设置`antigravity.usagePanelEnabled=false`、`antigravity.autoFailover.enabled=false`；aggregate/compact其他provider继续工作。
- Provider层回滚：从`webProviderExtensions()`移除Antigravity并隐藏UI/API分支；保留用户credential和normalized cache。
- 共享aggregate回滚必须保留前三provider既有契约，不删除Compact偏好。

## 当前阻塞

UI设计员HTML原型和用户审批缺失；task-level implementation plan也未通过Studio工具保存。设计完成不等于可实现，主会话必须先完成 [ui.md](./ui.md) 门禁。
