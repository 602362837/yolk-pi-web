# Design：Grok CLI 指定账号原位重新登录

## 1. 方案摘要

在现有 OAuth login SSE 路由上增加 Grok-only `accountMode=reauth`，OAuth 过程继续使用 isolated in-memory `CredentialStore`。只有上游 login 成功并返回可验证 Grok credential 后，服务端才在同一 opaque storage id 下提交替换。

提交阶段保留账号 metadata/Active 关系，协调 Grok token refresh、Activate 与 reauth，清除旧 quota cache，并仅在目标仍为 Active 时更新 `auth.json` 和 reload live runtime。UI 在 Models 中提供账号级 CTA、失效 banner CTA 和完整状态；Top-bar 只带安全 focus context 打开 Models。

## 2. AS-IS 数据流

### 添加账号

```text
Models → handleLogin("add")
  → GET /api/auth/login/grok-cli?accountMode=add (SSE)
  → isolated ModelRuntime + memory CredentialStore
  → pi-grok-cli login callbacks
  → saveOAuthAccountCredential(provider, credential)
  → allocate acct_* + write credential + metadata
```

### quota 发现失效

```text
GET /api/auth/quota/grok-cli?accountId=acct_*
  → getGrokAccessToken()
  → refresh failed / billing 401|403 retry failed
  → GrokQuotaResultV1 { reauthRequired:true, error.code:"unauthorized" }
  → GrokQuotaView / GrokUsagePanel 文案
```

### 当前缺口

- `ModelsConfig` Grok quota guard 和 render 依赖 `provider.loggedIn`，invalid saved account 可能看不到 quota 恢复态。
- managed account 行无 reauth action。
- add 总是新 storage id。
- Grok refresh/Activate/reauth 尚无统一互斥边界。
- 同 storage id 改凭据后，旧 persisted/in-flight quota 可能串用。

## 3. TO-BE 数据流

```text
账号行/reauth banner 点击
  → UI 确认目标与 Active 影响
  → 选择 browser | device | existing
  → GET /api/auth/login/grok-cli?accountMode=reauth&accountId=acct_* (SSE)
  → route preflight：provider/mode/account existence
  → isolated ModelRuntime + memory CredentialStore
  → runtime.login("grok-cli", "oauth", interaction)
  → validate credential
  → reauthenticateOAuthAccount("grok-cli", acct_*, credential)
      → shared Grok provider lock
      → lock-time reread target + current Active
      → atomic in-place credential/metadata update
      → if still Active: CredentialStore.modify(auth.json)
      → invalidate token flight + old quota cache generation/persisted entry
  → if Active: await reloadRpcAuthState()
  → SSE safe success summary
  → UI reload provider/accounts + force new quota
```

## 4. API 契约

### 4.1 OAuth login GET

现有 route：`GET /api/auth/login/[provider]`

新增 query：

```text
accountMode=reauth
accountId=<opaque saved-account storage id>
```

约束：

| 条件 | 结果 |
| --- | --- |
| mode 为空 | 保持现有 provider login 行为 |
| `accountMode=add` | 保持现有 managed add 行为 |
| `accountMode=reauth`, provider=`grok-cli`, accountId 存在 | 启动 isolated reauth |
| reauth 缺 accountId | SSE error / 400 等价固定错误 |
| reauth provider 非 Grok | fail closed，`reauth_not_supported` |
| target 不存在 | `account_not_found`，不启动/不提交写入 |
| add 携带 accountId 或未知 mode | 拒绝歧义参数 |

SSE success 建议安全投影：

```ts
{
  type: "success";
  message: string;
  account: OAuthAccountSummary;
  reauthenticated: true;
  active: boolean;
}
```

不得返回 credential、真实 refresh hash、callback code/URL、路径或 raw error。

### 4.2 OAuth login POST

现有 `{ token, code }` callback/prompt 回填不改 shape。token 仍绑定 provider；pending registry 生命周期与 disconnect cleanup 保持。

### 4.3 Accounts API

不新增顶级 route。账号 list/activate/delete 继续使用：

- `GET /api/auth/accounts/grok-cli`
- `POST /api/auth/accounts/grok-cli/activate`
- `DELETE /api/auth/accounts/grok-cli`

重新登录提交不走通用 accounts `POST`（该 POST 是 credential import，且 Grok 明确不支持 import），避免把浏览器可提交 credential 的能力引入 API。

## 5. 存储服务契约

建议在 `lib/oauth-accounts.ts` 增加专用服务：

```ts
reauthenticateOAuthAccount(
  provider: "grok-cli",
  storageId: string,
  credential: unknown,
): Promise<{
  account: OAuthAccountSummary;
  accounts: OAuthAccountsList;
  active: boolean;
}>
```

### 保留字段

- `accountId`（opaque storage id）
- `label`
- `extraInfo`
- `createdAt`
- `lastActivatedAt`
- `activeAccountId` 指向关系

### 更新字段

- secret credential file 内容
- metadata 中 provider-native diagnostic id（当前字段名历史上是 `chatgptAccountId`）
- `updatedAt`
- masked id/display fallback（由新 diagnostic id 派生）

### 写入要求

- 目标必须在 lock-time 仍存在，不能把被删除 target 重新创建。
- credential 与 metadata 均使用 same-dir tmp + rename，保持 `0600`；目录 `0700`。
- 两文件无法获得跨文件原子性，应保留旧内存快照并在第二阶段失败时 best-effort rollback；错误不得包含 secret/path。
- 如果 Active mirror 更新失败，整个 reauth 返回失败并 best-effort 恢复 store/metadata；不能返回“成功”但仍使用旧 Active。
- `reloadRpcAuthState()` 在持久化成功后执行。若 reload 个别 wrapper 清理失败，应遵循现有 reload 的错误契约，至少不回滚已成功的 durable credential；API 给固定“已保存但运行时刷新不完整”警告或统一失败，由实现评审时按现有 reload 行为确定，不能伪称回滚。

## 6. 并发设计

### 6.1 Grok provider lock

建议新增 `lib/grok-account-lock.ts`，复用 Kiro/Antigravity 的 process mutex + cross-process mkdir owner-lock 模式。

同一协调边界覆盖：

- `activateOAuthAccount("grok-cli", ...)`
- `getGrokAccessToken()` 的 credential read + refresh + write + active mirror CAS
- `reauthenticateOAuthAccount("grok-cli", ...)`

目的：

- 旧 refresh 先执行时，reauth 等待后最终写入新 credential。
- reauth 先执行时，后续 refresh 必须重读新 credential。
- Activate 与 reauth 并发时，以 lock-time/commit-time Active 为权威，不用 OAuth 开始时的陈旧状态。

不得在锁内再次调用会获取同一非重入锁的函数；实现员需明确锁层级，避免 `listOAuthAccounts()`/sync 路径递归加锁。

### 6.2 token flight

reauth commit 后调用 `invalidateGrokTokenFlight(storageId)`。共享 lock 保证旧 flight 不会在 commit 后继续覆盖；新请求重读新 credential。

### 6.3 quota generation 与持久化清理

仅删除 `quotaCache` Map 不够。建议：

- 为每个 account 维护 quota generation/epoch。
- query flight 捕获 generation；写入内存/持久化前确认未失效。
- reauth 成功后 bump generation、删除内存 entry、删除 `.quota-cache.json.entries[storageId]`（atomic write）。
- 旧 flight 可完成网络请求，但结果被 generation check 丢弃。

这样即使用户用另一 xAI 身份替换槽位，也不会显示旧身份的 stale quota。

## 7. Active 与 runtime 语义

### 非 Active target

- 更新 saved slot。
- Active metadata、`auth.json`、live runtime 不变。
- UI 成功后可强刷该 target quota，但不切 Active。

### Active target

- slot 更新后，`CredentialStore.modify("grok-cli")` 镜像新 OAuth credential。
- Active storage id 不变。
- `await reloadRpcAuthState()` offline refresh model descriptors并清理 provider session resources。
- 当前/新会话后续请求使用新凭据；in-flight request 不变。

### OAuth 失败/取消

因为 login runtime 使用 memory store，提交函数未调用；durable store、Active mirror、cache 均不变。

## 8. UI 状态与组件边界

### ModelsConfig

- 将 managed provider 可见性从单一 `loggedIn` 扩展为 `loggedIn || accountCount > 0`。
- Grok quota guard/render 与 Kiro 对齐：有 saved accounts 时仍可查询和显示 reauth。
- 增加 reauth controller state：target、confirm、method、SSE login state、busy/terminal。
- Grok 上游 method preference ref 使用 `browser | device | existing`；add 与 reauth 共用 method picker/controller，但持久化 mode 不同。
- `OAuthAccountsView` 使用 optional Grok-only `onReauthenticate`，不要给其他 provider 假能力。
- `GrokQuotaView` 增加 optional CTA props，保持它本身不发网络请求。

### Top-bar 与深链

- `GrokUsagePanel` 在 reauth link 点击时传递 `{ providerId:"grok-cli", accountId: activeAccountId }` 的安全 UI focus context。
- `AppShell` 保存一次性 Models initial target；`ModelsConfig` provider 列表加载后聚焦对应 OAuth detail；target account 传给 `OAuthDetail` 作为 initial selection。
- 打开 Models 后清除/消费 focus context，避免下一次普通打开仍跳 Grok。
- hover/focus aggregate panel 不直接启动 OAuth。

### UI 原型门禁

详见 [ui.md](./ui.md)。HTML 原型完成和审批前，UI 结构不可视为最终决定。

## 9. 错误与安全

建议新增 Grok login safe mapper（可放 route-local 或 `lib/grok-login-errors.ts`）：

- cancelled → `cancelled`
- target missing/conflict → 固定本地文案
- callback timeout/bind、authorization denied、device expired、refresh missing 等 → 固定可操作文案
- 其他 → “Grok 登录失败，请重试或改用其他登录方式。”

不要把 `pi-grok-cli` 可能包含 token endpoint response text 的 `Error.message` 原样送到 SSE。现有 Grok add flow也应复用该 mapper，避免同一路由两套安全标准。

## 10. 兼容性与迁移

- 不修改账号目录结构和 schema version；旧 account metadata 可直接使用。
- 不迁移/重写 Session JSONL、usage ledger、models.json、pi-web.json。
- 现有 `accountMode=add` 与 provider-wide login 保持。
- metadata 历史字段 `chatgptAccountId` 暂不在本任务重命名，避免广泛迁移；文档明确其现在承载 provider-native diagnostic id。
- `pi-grok-cli@0.5.0` 保持 exact pin，不 deep import私有实现。

## 11. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 用户在浏览器登录了另一 xAI 身份 | 确认 dialog 明示槽位替换；成功后更新 masked diagnostic id；不声称身份一致 |
| 旧 refresh 覆盖新 credential | shared Grok provider lock + reauth 后 flight invalidation |
| 旧 quota 泄漏到新账号 | generation invalidation + 删除 persisted entry，首次新查询失败不使用旧 stale |
| Active 更新一半成功 | lock、atomic files、旧快照 best-effort rollback、固定错误；测试故障注入 |
| invalid provider 从 Models 消失 | managed `accountCount>0` 也作为已有 provider 展示 |
| 登录方式点一次又选择一次 | preferred Grok method 自动回答真实 option id，未知 options 安全 fallback |
| Top-bar 误触直接弹外部 OAuth | 只深链 Models；OAuth 必须在确认后开始 |
| 扩展成所有 provider 造成未审查行为 | route P0 allowlist 仅 `grok-cli`，公共 primitive 不等于公开能力 |

## 12. 回滚

1. UI stop-bleed：隐藏 per-account reauth CTA 和 Top-bar deep-link target，保留原“添加账号”。
2. API stop-bleed：拒绝 `accountMode=reauth`，保留 add/login。
3. 保留已成功原位更新的 credential；它仍是合法 Grok saved account，不做反向数据迁移。
4. provider lock/cache generation 可保留作为安全加强；若必须回滚代码，先确认没有 in-flight reauth，再回到旧 refresh/activate 实现。
5. 不删除 `auth-accounts/grok-cli/`、quota cache、Session JSONL。
