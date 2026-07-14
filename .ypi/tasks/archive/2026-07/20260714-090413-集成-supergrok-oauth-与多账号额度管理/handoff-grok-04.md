# Handoff：GROK-04 — Grok billing quota cache 与安全 API

## Subtask

**ID**: GROK-04 | **Phase**: quota | **DependsOn**: GROK-02

## Files Changed

- `lib/grok-subscription-quota.ts` — **新增**。Grok /billing 独立 quota service：
  - 解析 `/billing` (monthly: `monthlyLimit.val`, `used.val`, `billingPeriodEnd`) 和 `/billing?format=credits` (weekly: `currentPeriod.type`, `creditUsagePercent`)
  - 不深路径 import pi-grok-cli，使用固定 `https://cli-chat-proxy.grok.com/v1` billing base URL
  - 60s fresh / 24h stale / single-flight (`grok-cli:<accountId>`) / 10s fetch timeout
  - 401/403 → 调用 `getGrokAccessToken()` refresh + 单次 retry
  - 429/5xx/network → 返回 stale 缓存（24h 内）；无缓存返回 `none` + retryable error
  - In-memory cache + persisted normalized cache (`.quota-cache.json`, atomic tmp+rename, 0600)
  - 安全投影 `GrokQuotaResultV1`：仅 allowlist 数字、ISO 时间、状态枚举、清洗消息；无 credentials/raw payload/error body/base URL/路径
  - Weekly 失败不阻断 monthly
  - `invalidateGrokQuotaCache()` 供 force refresh

- `app/api/auth/quota/[provider]/route.ts` — **修改**。增加 grok-cli 分发：
  - `GET ?accountId=<opaque>&refresh=1` → `getGrokAccountSubscriptionQuota()` / `getGrokActiveSubscriptionQuota()`
  - 响应 `Cache-Control: no-store`
  - `POST` 对 grok-cli 返回 405（不支持 reset-credit）
  - OpenAI Codex 路径不变

- `package.json` — **修改**。新增 `test:grok-quota` 脚本

- `scripts/test-grok-quota.mjs` — **新增**。48 项 fixture/cache/failure/contract 测试（无 live xAI endpoint）

## Verification

```bash
npm run lint                    # ✅ 0 errors, 0 warnings
node_modules/.bin/tsc --noEmit # ✅ 0 errors
npm run test:grok-quota         # ✅ 48 passed, 0 failed
```

## Acceptance

- [x] 额度映射正确（monthly limit/used/remaining/utilization/resetsAt；weekly usedPercent/resetsAt）
- [x] Weekly 缺失时 monthly 不受影响
- [x] fresh / stale / none / reauthRequired 状态确定
- [x] 401/403 触发 refresh+retry（已实现于 `fetchBillingData` + `queryGrokBilling`）
- [x] 无 raw upstream payload 或 credential 进入响应（测试验证 JSON 不含 access/refresh/token/config 字段）
- [x] `Cache-Control: no-store`（route 层设置）
- [x] POST 对 grok-cli 返回 405
- [x] 不深路径 import pi-grok-cli

## Design Compliance

| Contract | Implemented |
|---|---|
| 60s fresh / 24h stale / single-flight | ✅ |
| 10s fetch timeout | ✅ |
| 401/403 → refresh + single retry | ✅ |
| Safe projection (no secrets / raw body) | ✅ |
| `Cache-Control: no-store` | ✅ |
| Monthly required, weekly optional | ✅ |
| POST reset-credit unsupported (405) | ✅ |
| Persisted normalized cache | ✅ |
| No pi-grok-cli deep import | ✅ |

## Notes / Risks

1. **Billing endpoint 非公开 API**：`cli-chat-proxy.grok.com/v1/billing` 是 Grok Build 内部 endpoint，字段可能变化。解析层 `parseMonthlyBilling` / `parseWeeklyBilling` 严格校验并在失败时返回 `invalid_payload`，不泄露 raw body。

2. **Persisted cache 格式**：v1 使用独立 `.quota-cache.json`（非 oauth-accounts 的 `quotaCache` 字段），避免污染 OpenAI Codex shape。后续可在 GROK-05 中考虑统一。

3. **In-memory cache 为进程级**：多进程部署（cluster/PM2）各自持有独立 cache；stale 回退到 persisted file cache 提供跨进程/跨重启降级。

4. **路由响应语义**：Grok quota GET 成功返回 200，`reauthRequired=true` 返回 401，其他失败返回 502。UI 应根据 `cache.state` 和 `reauthRequired` 决定展示，而非仅依赖 HTTP status。

5. **`GROK_CLI_BASE_URL` env 不自动读取**：v1 硬编码 `https://cli-chat-proxy.grok.com/v1`，与 `pi-grok-cli` 的 `getBaseUrl()` 默认值一致。若需支持自定义 endpoint，后续任务可读取 env。

## Decisions Needed from Main Session

- None for GROK-04. All product decisions (fresh/stale TTL, session pinning, provider scope) were approved before implementation.
