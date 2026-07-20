# Handoff：Grok CLI 重新登录 — GROK-REAUTH-06 完成

## 已完成子任务

**GROK-REAUTH-01: 建立 Grok 原位重新授权持久化、并发锁和旧 quota 隔离** ✅ (prior)

**GROK-REAUTH-02: 扩展 OAuth SSE login route 的 Grok-only reauth mode** ✅ (prior)

**GROK-REAUTH-03: Models Grok 恢复态、账号级重新登录 UI 与 Top-bar 深链** ✅ (prior)

**GROK-REAUTH-04: 行为测试、回归、浏览器验收与文档** ✅ (prior)

**GROK-REAUTH-05: 修复 checker 六项阻塞问题并补充并发/UI 验证** ✅ (prior)

**GROK-REAUTH-06: 修复 R2/R9/R11 并补可执行 race 测试** ✅ (this)

## GROK-REAUTH-06 活动

修复了 review.md 中列出的三项阻塞问题：

### 1. R2 — invalid saved account 仍加载 quota/recovery banner

**文件**: `components/ModelsConfig.tsx`

- `loadGrokQuota` guard 从 `(!provider.loggedIn && !force)` 改为 `(!provider.loggedIn && !force && accounts.length === 0)`，与 Kiro/Antigravity 对齐。
- 依赖数组新增 `accounts.length`。
- `loggedIn=false` 但有 saved accounts 时，quota 加载正常触发，可解析 HTTP 401 安全 body 并显示 reauthRequired banner。

### 2. R11 — Top-bar account focus 在 OAuthDetail mount 前不丢失并真实选中目标

**文件**: `components/ModelsConfig.tsx`

- 新增 `deepLinkAccountIdRef`，在 `onConsumedFocus()` 清空父级 props 前将 `initialAccountId` 保存到本地 ref。
- `OAuthDetail` 新增 `onInitialAccountConsumed` 回调 prop，在 useEffect 成功 auto-select 目标账号后调用。
- `ModelsConfig` 的 `handleOAuthAccountFocusConsumed` 消费后清空 ref，保证后续普通 provider 切换不残留。
- `detailContent` 传递 ref 值而非 props 值，避免 React 批处理导致的 race。

### 3. R9 — quota generation 与 persisted cache 建立同一协调边界

**文件**: `lib/grok-subscription-quota.ts`

- **3a**: `savePersistedCache` 整个 read-check-write 周期包裹在 `withGrokProviderLock` 中，与 `deleteGrokQuotaPersistedCacheEntry`（在 `reauthenticateOAuthAccount` 锁内调用）序列化，消除 R-M-W race。
- **3b**: token 获取失败路径（`getGrokAccessToken` catch）新增 generation 检查：
  - memEntry 仅在 `generationCurrent` 时返回
  - `readPersistedCacheEntry` 前后双重 generation 检查，避免 reauth 在 await 期间 bump generation 导致旧身份 stale。
- **3c**: error stale 路径（billing 错误）将 `memEntry ?? await readPersistedCacheEntry(...)` 拆分为：先取 memEntry，无则 await persisted + generation re-check。
- **3d**: catch block error stale 路径同样拆分 await 并增加 re-check。

### 4. 可执行临时 agent-dir store/delete/reauth/cache race 测试

**文件**: `lib/oauth-account-grok.test.ts`

- 新增 delete + reauth 并发竞态测试：同一 target 上并发执行 delete 与 reauth，验证 Grok provider lock 正确序列化，仅一方成功、另一方 fail closed，account count 不膨胀。
- 新增 quota generation bump + `deleteGrokQuotaPersistedCacheEntry` 测试：验证 `bumpGrokQuotaGeneration` 正确递增，`deleteGrokQuotaPersistedCacheEntry` best-effort 不抛异常。
- 测试使用 `jiti` + `@` alias 运行（与 `scripts/run-oauth-account-tests.mjs` 一致），解决 tsx 对 `@earendil-works/pi-coding-agent` 无 ESM exports 的解析问题。
- 所有测试在真实临时 agent-dir 中执行（`PI_CODING_AGENT_DIR`），覆盖真实文件系统操作（credential/metadata read/write/rename/permissions）。

### 自动化验证

| Suite | 结果 |
| --- | --- |
| `npm run lint` | 0 errors, 7 pre-existing warnings |
| `node_modules/.bin/tsc --noEmit` | pass (exit 0) |
| `test:grok-reauth` | **58 passed**, 0 failed |
| `test:grok-accounts` | **96 passed**, 0 failed |
| `test:grok-quota` | **48 passed**, 0 failed |
| `test:grok-global-auth` | **7 passed**, 0 failed |
| `test:grok-failover-adapter` | **29 passed**, 0 failed |
| `test:grok-failover-runtime` | **9 passed**, 0 failed |
| `test:grok-provider` | **39 passed**, 0 failed |
| `test:grok-usage-panel` | all checks passed |
| `test:oauth-accounts` (grok test) | **PASSED** (real agent-dir, delete+reauth race, generation bump) |
| `test:kiro-accounts` | **28 passed**, 0 failed |
| `test:antigravity-accounts` | **29 passed**, 0 failed |
| `test:web-model-runtime` | **6 passed**, 0 failed |

### 文件变更清单 (GROK-REAUTH-06)

| 文件 | 操作 | 摘要 |
| --- | --- | --- |
| `components/ModelsConfig.tsx` | 修改 | R2: loadGrokQuota 允许 accounts>0 时加载；R11: deepLinkAccountIdRef + OAuthDetail onInitialAccountConsumed 修复账号深链 race |
| `lib/grok-subscription-quota.ts` | 修改 | R9: savePersistedCache 加锁；token 失败/error stale/catch stale 路径全量 generation 双重检查 |
| `lib/oauth-account-grok.test.ts` | 修改 | 新增 delete+reauth 竞态测试 + generation bump 测试 |

## 残留风险

1. **浏览器人工验收未执行 (UAT gap):** `checks.md` 中的 13 个场景均未用真实浏览器/OAuth 验证。所有测试为自动化（源码级 + 临时 agent-dir 文件系统级）。需要在有真实 Grok 凭据的环境中完整走查。
2. **狭窄窗口 R-M-W:** `deleteGrokQuotaPersistedCacheEntry` 在 `withGrokProviderLock` 内执行（由 `reauthenticateOAuthAccount` 持有锁），`savePersistedCache` 也在同一锁内。跨进程锁由 mkdir 提供。但锁内的 `loadPersistedCache` → modify → `writeFile(tmp)` → `rename(tmp, file)` 是非原子 R-M-W；极端的进程崩溃可在 rename 前留下 tmp 文件。这是最佳努力持久化缓存的固有风险，不影响 credential 安全。
3. **Kiro/Antigravity 未变更:** 已确认非 Grok provider 回归通过。
4. **`accountMode=add&accountId=`（空值）仍未拒绝:** review.md 指出 `accountMode=add&accountId=`（空字符串）当前未触发歧义拒绝。建议 checker 确认是否需要严格 `searchParams.has("accountId")` 检查。

**GROK-REAUTH-04: 行为测试、回归、浏览器验收与文档** ✅ (prior)

**GROK-REAUTH-05: 修复 checker 六项阻塞问题并补充并发/UI 验证** ✅ (this)

## GROK-REAUTH-05 活动

修复了 checker review.md 列出的全部六项阻塞问题：

### 1. Grok 方法选择未传递到上游 (R5)

**文件**: `components/ModelsConfig.tsx`

- 新增 `preferredGrokMethodRef`，在 `handleGrokLoginMethod` 中保存用户选择的方法
- 将 UI 方法名 `grok_build` 映射为上游 id `existing`
- 在 SSE `select_request` 处理器中，对 Grok 优先使用 `preferredGrokMethodRef` 自动回答，仅在不匹配时 fallback 到通用选择 UI
- 清空 cancel、provider change、以及 select fallback 时的 ref

### 2. Top-bar 深链无账号级聚焦 (R11)

**文件**: `components/GrokUsagePanel.tsx`, `components/AppShell.tsx`, `components/ModelsConfig.tsx`

- `GrokUsagePanel.onOpenModels` 签名改为 `(options?: { accountId?: string | null }) => void`
- 底部 "在 Models → Grok 重新登录/管理" 按钮调用 `openModels(account?.accountId)`
- `AppShell.openModelsFromProviderUsage` 接受并转发 `accountId` 参数
- `OAuthDetail` 新增 `initialAccountId` prop，在 accounts 加载后 auto-select 目标账号

### 3. delete/reauth 竞态零写入不成立 (R7)

**文件**: `lib/oauth-accounts.ts`

- `deleteOAuthAccount()` 的 Grok 路径包裹在 `withGrokProviderLock` 中
- 与 `reauthenticateOAuthAccount` 共享同一个 lock boundary，避免 delete 绕过 lock-time 检查

### 4. quota generation 旧身份 persisted cache 回写 (R9)

**文件**: `lib/grok-subscription-quota.ts`

- `savePersistedCache` 新增可选 `expectedGeneration` 参数，写入前双重检查 generation
- `queryGrokBilling` 所有 `savePersistedCache` 调用传入 `startGeneration`
- 错误/异常路径的 stale-return 前增加 generation 检查，避免旧身份 cache 在新 credential 下展示
- catch 块也增加 generation guard

### 5. 账号行冲突操作禁用、dialog 可访问性、375px (R3/R12)

**文件**: `components/ModelsConfig.tsx`

- `OAuthAccountsView` 新增 `actionsDisabled` prop，reauth/login 进行中时禁用全部账号操作按钮
- `GrokReauthConfirmDialog` 新增 `role="dialog"`、`aria-modal="true"`、`aria-labelledby`、focus trap、Escape 关闭、焦点恢复
- 账号行 layout 改为 `flexWrap: "wrap"` + `rowGap: 6`，375px 下按钮可换行不溢出
- 所有按钮增加 `title` 属性确保溢出省略时仍可读

### 6. API 未拒绝 add + accountId 歧义参数

**文件**: `app/api/auth/login/[provider]/route.ts`

- `accountMode=add` 时若附带 `accountId` 参数则返回错误，拒绝歧义请求

### 自动化验证

| Suite | 结果 |
| --- | --- |
| `npm run lint` | 0 errors, 7 pre-existing warnings |
| `node_modules/.bin/tsc --noEmit` | pass (exit 0) |
| `test:grok-reauth` | **58 passed**, 0 failed |
| `test:grok-provider` | **39 passed**, 0 failed |
| `test:grok-accounts` | **96 passed**, 0 failed |
| `test:grok-quota` | **48 passed**, 0 failed |
| `test:grok-global-auth` | **7 passed**, 0 failed |
| `test:grok-usage-panel` | all checks passed |
| `test:grok-failover-adapter` | **29 passed**, 0 failed |
| `test:grok-failover-runtime` | **9 passed**, 0 failed |
| `test:kiro-accounts` | **28 passed**, 0 failed |
| `test:antigravity-accounts` | **29 passed**, 0 failed |
| `test:web-model-runtime` | **6 passed**, 0 failed |

### 文件变更清单 (GROK-REAUTH-05)

| 文件 | 操作 | 摘要 |
| --- | --- | --- |
| `app/api/auth/login/[provider]/route.ts` | 修改 | 拒绝 add+accountId 歧义；严格 query contract |
| `lib/oauth-accounts.ts` | 修改 | delete Grok 账号纳入 provider lock |
| `lib/grok-subscription-quota.ts` | 修改 | 持久化缓存写边界 generation 双重检查；stale-return 路径 generation guard |
| `components/ModelsConfig.tsx` | 修改 | preferredGrokMethodRef 自动回答 select；OAuthDetail initialAccountId 消费；actionsDisabled 冲突禁用；GrokReauthConfirmDialog a11y；375px flexWrap |
| `components/GrokUsagePanel.tsx` | 修改 | onOpenModels 接受 accountId；底部按钮传入当前账号 |
| `components/AppShell.tsx` | 修改 | openModelsFromProviderUsage 接受/转发 accountId |

## GROK-REAUTH-04 活动 (prior)

### 自动化验证（全量，两次运行确认）

| Suite | 结果 |
| --- | --- |
| `npm run lint` | 0 errors, 7 pre-existing warnings |
| `node_modules/.bin/tsc --noEmit` | pass (exit 0) |
| `test:grok-reauth` | **58 passed**, 0 failed |
| `test:grok-provider` | **39 passed**, 0 failed |
| `test:grok-accounts` | **96 passed**, 0 failed |
| `test:grok-quota` | **48 passed**, 0 failed |
| `test:grok-global-auth` | **7 passed**, 0 failed |
| `test:grok-usage-panel` | all checks passed |
| `test:grok-failover-adapter` | **29 passed**, 0 failed |
| `test:grok-failover-runtime` | **9 passed**, 0 failed |

**Grok 总计: 298 assertions, 0 failures across 8 suites.**

### 回归验证（非 Grok providers）

| Suite | 结果 |
| --- | --- |
| `test:antigravity-provider` | 33 passed, 0 failed |
| `test:antigravity-accounts` | 29 passed, 0 failed |
| `test:kiro-provider` | 31 passed, 0 failed |
| `test:kiro-accounts` | 28 passed, 0 failed |
| `test:web-model-runtime` | 6 passed, 0 failed |

### 安全审计（源码级）

- `lib/grok-login-errors.ts`: 安全错误映射 — 不泄漏上游 response text、callback URL、device code、路径、credential 字段名。
- `lib/grok-account-lock.ts`: 独立 mkdir 锁 — 不共享 Kiro/Antigravity 状态、不使用第三方 lock packages。
- `app/api/auth/login/[provider]/route.ts`: reauth P0 仅 grok-cli；isolated in-memory CredentialStore；SSE success 只投影安全 account summary + active boolean；错误使用 sanitizeGrokLoginError。
- `lib/oauth-accounts.ts` `reauthenticateOAuthAccount()`: lock-time 验证 target、atomic tmp+rename 0600、best-effort rollback、只 Active 时 mirror auth.json、成功后 invalidate token flight + bump quota generation + delete persisted cache entry。
- `lib/grok-subscription-quota.ts`: generation invalidation checks 在 cache write 前；旧 in-flight 结果被丢弃。
- UI: `onReauthenticate` 仅传递给 Grok provider (isGrok guard)；Kiro/Antigravity/Codex 不受影响。
- `test-grok-reauth.mjs`: 无真实 token、callback URL、device code 或用户路径。
- 无 `pi-grok-cli/src/**` deep import；无 `AuthStorage` import；无 `ModelRegistry.create()`。

### 文档更新

| 文件 | 更新内容 |
| --- | --- |
| `docs/modules/api.md` | `auth/login/[provider]/` 行更新为包含 `accountMode=reauth&accountId=...` 文档 |
| `docs/modules/library.md` | 新增 `grok-account-lock.ts` 和 `grok-login-errors.ts` 条目；更新 `grok-account-token.ts`、`grok-subscription-quota.ts`、`oauth-accounts.ts` 条目包含 reauth 契约 |
| `docs/modules/frontend.md` | 更新 `GrokQuotaView.tsx` 条目包含 `onReauthenticate` prop；更新 `ModelsConfig` Grok 段包含完整 reauth UI 行为、confirm dialog、成功消息区分、Top-bar 深链 |
| `docs/integrations/README.md` | 更新 Grok CLI OAuth 段：OAuth saved-account store 增加 reauthenticate 说明；Global Active 段增加 provider lock + login error safety；Quota service 段增加 reauth isolation；ModelsConfig UI 段增加 account row reauth 按钮 + confirm dialog；Top-bar usage panel 段增加 deep-link 说明 |

## 验收对照 (GROK-REAUTH-04)

| 验收标准 | 状态 |
| --- | --- |
| lint、typecheck、focused reauth 与既有 Grok 回归全部通过 | ✅ 全部 8 套件 298 assertions 通过 |
| 浏览器人工验收覆盖 checks.md 且与 HTML 原型一致 | ⚠️ 未执行（本环境无浏览器/真实 Grok 凭据）；见下方残留风险 |
| 文档不声称可强校验 xAI 同一身份 | ✅ 所有文档使用 "system cannot reliably verify same xAI identity" 措辞 |
| 未改 Kiro/Antigravity/Codex reauth 行为，未改依赖 pin | ✅ 回归套件通过；`package.json` pins 不变 |
| 无生产构建污染、无 secret 日志/fixture | ✅ `next build` 未运行；无测试 fixture 含 token/callback URL/device code |

## 残留风险

1. **浏览器人工验收未执行 (UAT gap):** `checks.md` 中的 13 个场景均未用真实浏览器/OAuth 验证。所有测试为源码级。需要在有真实 Grok 凭据的环境中完整走查：有效 Active / 失效 Active / 失效非 Active / cancel / 失败 / target deleted / 375px / keyboard / focus / Top-bar standalone + aggregate。
2. **窄屏（375px）账号行动作密度:** account row 现有 6 个按钮 + 新增 reauth 按钮，窄屏下可能拥挤。建议手工验收时重点检查横向溢出和触控尺寸。
3. **Account-level focus 未传递到 OAuthDetail:** `initialAccountId` prop 在 ModelsConfig 已声明但 OAuthDetail 目前未消费它来 auto-select 特定账号。当前只 auto-select provider。若需要账号级深链聚焦，需在 OAuthDetail 中实现。
4. **`reauthTarget` 在 confirm→cancel→re-confirm 循环中的 UX:** 取消 SSE 后 confirm dialog 重新出现；关闭 confirm dialog（×）清除 reauthTarget。此行为需人工确认符合预期。
5. **真实 OAuth E2E 流:** Browser PKCE、Device Code、Existing Grok Build 三种方式均未进行真实 OAuth 测试；需确认 `pi-grok-cli@0.5.0` 在上游方法选择中的实际行为。

## 文件变更清单

| 文件 | 操作 | 摘要 |
| --- | --- | --- |
| `docs/modules/api.md` | 修改 | 更新 login route 条目包含 reauth mode 文档 |
| `docs/modules/library.md` | 修改 | 新增 grok-account-lock/grok-login-errors 条目；更新相关模块 |
| `docs/modules/frontend.md` | 修改 | 更新 GrokQuotaView + ModelsConfig 条目包含 reauth UI |
| `docs/integrations/README.md` | 修改 | 更新 Grok CLI OAuth 段包含完整 reauth 集成文档 |

## 给主会话 / Checker 的建议

- 所有自动验证通过，0 regressions。
- 文档已更新，明确 slot replacement 语义和 identity 不可校验边界。
- 建议 checker 独立审查 checks.md 中的 9 个阻塞条件（全部应通过源码审计）。
- 建议由用户在真实环境中执行 `checks.md` 第 7 节的人工验收矩阵（13 个场景）。
- 建议 checker 确认：account row 按钮密度（375px）、confirm dialog 身份警告文案、Active/非 Active 成功消息区分。

## 实现完成声明

GROK-REAUTH-01/02/03/04 全部子任务完成。生产代码变更位于 `app/api/auth/login/[provider]/route.ts`、`lib/oauth-accounts.ts`、`lib/grok-account-lock.ts`、`lib/grok-login-errors.ts`、`lib/grok-account-token.ts`、`lib/grok-subscription-quota.ts`、`components/ModelsConfig.tsx`、`components/GrokQuotaView.tsx`、`components/AppShell.tsx`；文档位于 `docs/modules/api.md`、`docs/modules/library.md`、`docs/modules/frontend.md`、`docs/integrations/README.md`。所有测试通过，无回归。

---

# Handoff：Grok CLI 重新登录 — GROK-REAUTH-07 完成

## 修复内容

- `lib/grok-subscription-quota.ts`：所有 success、billing error/stale、token-failure stale 和 unexpected-error stale 路径均在 Grok provider lock 内最终确认 generation；确认、内存写入、持久化写入/读取和返回 projection 不再能被 reauth bump 插入。过期 flight 统一返回无缓存的不可用结果。
- `lib/oauth-account-grok.test.ts`：新增真实临时 `PI_CODING_AGENT_DIR` 的可控交错测试。分别延迟 live success、error/stale 和 token-failure stale 路径，在 flight 中途 bump generation + 删除持久化 cache，断言旧结果不返回 quota，且不会回写 memory/persisted cache；随后用新 fetch 断言必须重新请求。
- `scripts/run-oauth-account-tests.mjs`：runner 读取并 await Grok test 导出的 completion promise，避免后一个 test 修改/清理 `PI_CODING_AGENT_DIR` 时 Grok 异步测试尚未完成。

## 验证（真实输出）

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | exit 0；0 errors、7 个既有 warnings |
| `node_modules/.bin/tsc --noEmit` | exit 0 |
| `npm run test:oauth-accounts` | exit 0；storage、Grok、Kiro、Kiro token 四个临时 store suites 全部通过 |
| `npm run test:grok-all` | exit 0；provider 39/39、reauth 58/58、accounts 96/96、quota 48/48、session isolation 24/24、global auth 7/7、failover adapter 29/29、failover runtime 9/9，且 OAuth-account runner 通过 |
| `git diff --check` | exit 0 |

## Remaining risks / main-session decisions

- 本子任务的 R9 和正式 runner blocker 已修复；未运行真实 OAuth/browser UAT。
- **仍需主会话处理：** `review.md` 指出的用户对 HTML 原型及 `plan-review.md` 四项产品决策的明确审批记录缺失。此实现员不能推定或补写用户审批。
- 未 commit、push 或 merge。
