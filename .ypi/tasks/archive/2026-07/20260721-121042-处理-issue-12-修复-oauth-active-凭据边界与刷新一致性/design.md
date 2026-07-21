# Design：Issue #12 OAuth Active 凭据边界与刷新一致性

## 方案摘要

把 OAuth Active 生命周期拆成四条具名边界，并把 `listOAuthAccounts()` 降为纯投影：

```text
legacy auth-only ──bootstrap──> managed Active slot ──one-way mirror──> auth.json
successful login/runtime refresh ──adopt──> managed Active slot
explicit logout ──clear(lock-held logout + pointer clear)──> no Active
metadata callers ──read/list──> no writes / no refresh / no network
```

Grok 保持 PR #13 的 authority 与 transaction：

```text
refresh under Grok provider lock
  -> read authoritative slot at lock time
  -> upstream rotation R0 -> R1
  -> atomic slot commit R1
  -> re-read Active pointer
  -> Active only: mirror R1 to auth.json
  -> mirror failure: retain slot R1, surface safe error
  -> later valid-token resolution: compare and repair slot R1 -> mirror (no refresh)
```

旧 PR #14 只作为命名参考；实现基于当前 main 重写，不能 cherry-pick、rebase 或覆盖 PR #13 文件为旧版本。

## 当前状态与目标状态

### AS-IS

- `syncActiveOAuthAccountCredential` 既可能 bootstrap，也可能 overwrite/adopt、clear。
- non-Grok list 隐式调用 sync。
- list 还会 prune metadata、remote label backfill、写 metadata。
- login/providers/quota 靠 `.catch(() => {})` best-effort sync。
- logout 删除 `auth.json`但保留 Active pointer。
- Active-only callers常用完整 list。

### TO-BE

- read/list 是无副作用 read model。
- bootstrap/adopt/clear 是明确 mutation command。
- route 根据意图调用 command，不再把 list 当 reconciliation trigger。
- Grok mirror repair 单向、锁内、无需再次 refresh。

## 核心 API 契约

### 1. `readOAuthActiveAccountId(provider)`

建议签名：

```ts
export async function readOAuthActiveAccountId(provider: string): Promise<string | null>
```

行为：

1. `getAdapter(provider)` fail closed。
2. 读取/normalize `accounts.json`。
3. pointer 必须非空且对应 metadata entry。
4. 只做 slot existence check；不打开 secret内容。
5. 不读 `auth.json`、不写、不锁、不发网络。

该 helper 返回“可寻址 managed Active id”，不验证 credential完整 shape；需要 credential 的 caller继续通过已有 credential reader验证。

### 2. `bootstrapOAuthActiveAccountCredential(provider, credentials?)`

建议签名：

```ts
export async function bootstrapOAuthActiveAccountCredential(
  provider: string,
  credentials?: Pick<WebCredentialStore, "read">,
): Promise<OAuthAccountSummary | null>
```

算法（在 `withProviderAccountLock` 内）：

1. 读取 Active pointer；若 slot存在，打开并用 adapter验证。
2. valid slot：直接投影 summary，不读取 mirror，不写。
3. 无 valid slot：读取 raw canonical store的 provider credential。
4. valid mirror：创建新的 opaque slot（或仅在明确可安全复用时复用），`markActive=true`。
5. missing/invalid mirror：返回 `null`，不覆盖任何现有 slot。

幂等条件：首次创建后下一次调用命中 valid slot。

### 3. `adoptOAuthActiveAccountCredential(provider, credentials?)`

建议签名与 bootstrap 一致，但语义不同：

1. caller 必须已完成 provider-wide `runtime.login` 或 canonical `runtime.getAuth` refresh。
2. 在 provider lock 下读取 canonical mirror。
3. credential invalid：不清 pointer、不改 slot；返回 `null`/store error，caller不得宣告 success。
4. valid current Active slot：原位更新 slot，保留 opaque id与用户 metadata。
5. 无 valid Active slot：分配 opaque id并设 Active。
6. safe local display hint可在此 mutation 持久化，但不得覆盖用户 label。

危险边界：该函数允许 mirror → slot，故只能出现在明确 adoption call site；不得被 GET list、failover read、普通 token read调用。

### 4. `clearOAuthActiveAccount(provider, logout)`

建议签名：

```ts
export async function clearOAuthActiveAccount(
  provider: string,
  logout: () => Promise<void>,
): Promise<void>
```

算法：

1. 校验 provider。
2. 获取 provider account lock（Grok/Kiro/Antigravity；OpenAI直接串行）。
3. 锁内 `await logout()`，让 SDK runtime从 canonical credential store删除 mirror。
4. 同一临界区内原子写 metadata，清 `activeAccountId`。
5. 保留所有 slots与非 Active metadata。
6. 任一阶段失败都向 route传播，不能返回 `{ok:true}`。

把 logout callback放进 helper，而不是 route先 logout再拿锁，可关闭 refresh 在两步之间重新写 mirror 的窗口。Grok decorated store的 `delete()`当前委托 raw store，不会嵌套获取 Grok lock；此约束必须由测试/评审锁定。

### 5. `listOAuthAccounts(provider)`

pure projection 算法：

1. 只读 metadata。
2. 对 metadata entries只做 slot existence check；缺失项在 response中过滤，不写回 metadata。
3. Active pointer仅在被投影 entries包含时返回，否则 response为 `null`。
4. summary只来自 metadata allowlist；不读 `auth.json`、不打开 credential内容。
5. 不调用 `adapter.backfillLabel`；无网络。
6. sort逻辑保持 Active first、lastActivated/updated降序。

label兼容：

- 已持久化 label/remark不变。
- save/import/bootstrap/adopt mutation使用 adapter `deriveDisplayHint()` 的本地安全结果补新项label；不得覆盖用户设置或 `labelBackfillDisabledAt`。
- 远程 OpenAI userinfo backfill从 list移除；若未来保留，必须是独立命名 command/scheduler，不属于本 Issue。

## 锁分层

新增 internal helper：

```text
withProviderAccountLock(provider, run)
  grok-cli           -> withGrokProviderLock
  kiro               -> withKiroProviderLock
  google-antigravity -> withAntigravityProviderLock
  openai-codex       -> run
```

分层规则：

- public bootstrap/adopt/clear拥有 provider lock；内部使用 `...Unlocked` primitive。
- activate/delete/reauth继续只获取一次对应 provider lock。
- 锁内只使用 raw WebCredentialStore；不能使用 Grok decorator再次拿 provider lock。
- 固定锁序：provider lock → auth.json lock。
- read/list不拿写锁。

## Grok mirror repair 设计

### 新增/扩展 transaction primitive

在 `lib/grok-credential-transaction.ts` 增加 lock-held reconcile primitive，复用 `readGrokActiveSnapshotUnderLock`：

```ts
reconcileGrokActiveMirrorUnderLock({ rawStore, storageId }): Promise<{
  mirrored: boolean;
  activeChanged: boolean;
}>
```

要求：

- caller已持 Grok provider lock；
- 重新读取 Active snapshot；id不同则不写 mirror；
- 读取 raw mirror并做 credential语义比较；相同则 zero-write；
- 不同则 raw `CredentialStore.modify` 写入 snapshot credential；
- 只允许 slot → mirror；
- malformed/unwritable mirror抛固定安全错误，不改 slot。

### resolver 接线

`getGrokAccessToken()` 的 lock-held valid-token路径：

1. slot尚未过期且无需 force refresh；
2. 若该 storage id仍为 Active，调用 reconcile primitive；
3. mirror一致则直接返回；不一致则修复后返回；
4. non-Active直接返回，不写 mirror。

refresh路径继续调用现有 `commitGrokCredentialUnderLock()`，不复制旧 PR #14 的整段 resolver实现。

## 调用点矩阵

| 模块 | 当前 | 目标 |
| --- | --- | --- |
| accounts GET | list（可能隐式 sync） | bootstrap → pure list |
| providers GET | sync + list | best-effort bootstrap → pure list |
| persistent login | sync best-effort | adopt required → reload → success |
| add login | save | 不变：save non-Active |
| Grok reauth | 专用 transaction | 不变，不 adopt |
| logout | runtime.logout only | clear(provider, runtime.logout callback) → reload |
| Activate | sync → mirror/metadata → list | 无 sync；target credential → mirror/metadata → pure list |
| delete | sync → guard/delete/list | metadata Active guard → delete → pure list |
| OpenAI active quota | runtime refresh → sync → list active | runtime refresh → adopt → read Active id |
| Grok session active helper | list active | read Active id |
| Grok/Kiro/Anti active quota | list active | read Active id |
| Kiro/Anti token lock fallback | list active | read Active id |
| failover current Active checks | list active | read Active id |
| failover candidate enumeration | list accounts | 保留 pure list |
| ChatGPT scheduler/candidate enumeration | list accounts | 保留 pure list |

完成后 `rg syncActiveOAuthAccountCredential` 在 production code应为零；若 export无兼容消费者则删除。

## Route / Wire 契约

### Accounts GET

- route path/method/body/response不变。
- bootstrap错误进入现有 `OAuthAccountStoreError` mapper。
- response仍为 `OAuthAccountsList`。

### Providers GET

- 一个 provider bootstrap失败不得阻断其他 provider。
- accountCount/displayName来自 pure list。
- `runtime.checkAuth`逻辑不变。

### Login SSE

- add/reauth分支不变。
-普通 provider-wide login：managed provider adopt必须完成；失败走现有 safe error mapper。
- Grok/Antigravity继续不投影 raw upstream error。

### Logout

- unknown provider检查不变。
- clear helper lock-held执行 `runtime.logout`与pointer clear。
- 两步成功后才 reload并返回 `{ok:true}`。

### Quota

- wire与cache status不变。
- OpenAI canonical runtime refresh后显式 adopt；account-specific non-Active refresh不 adopt。
- Grok/Kiro/Anti active route只改 storage-id读取方式。

## 数据与文件契约

不变：

```text
~/.pi/agent/auth.json
~/.pi/agent/auth-accounts/<provider>/accounts.json
~/.pi/agent/auth-accounts/<provider>/<opaque-id>.json
~/.pi/agent/auth-accounts/<provider>/deleted/
```

- 无 schema migration。
- list不清理 orphan metadata；后续显式 mutation可自然修复。
- logout不删除 slot。
- permissions保持 `0700`/`0600`。

## 并发时序

### refresh A 与 list

- refresh持 provider lock远程轮换。
- list不获取写锁且无写路径，可并发读取旧或新 metadata projection。
- refresh结束后 slot/mirror均为新版本；list无法回写旧版本。

### refresh A 与 Activate B

- 二者共享 provider lock，按锁顺序串行。
- refresh先：A slot轮换并mirror A，随后 Activate B设置 pointer/mirror B，最终B。
- Activate先：pointer/mirror B，随后 A为non-Active，只更新A slot，不碰mirror。

### mirror失败

```text
slot=A:R1 (durable)
auth=A:R0 (old or malformed)
request returns safe failure
restore auth readability
next valid-token read(A)
  -> lock
  -> Active still A
  -> compare R1 != R0
  -> auth=A:R1
  -> no OAuth refresh
```

若期间 Activate B，则 repair看到 Active changed，绝不把A写到mirror。

## 失败语义

| 失败点 | 结果 |
| --- | --- |
| metadata malformed | fail closed；无写、无 refresh |
| bootstrap mirror invalid | 返回 null；不覆盖 slot |
| adopt mirror invalid | 不改 managed state；login/quota不得虚报成功 |
| upstream refresh失败 | slot/mirror零写 |
| slot写失败 | mirror不写，旧slot保留 |
| mirror写失败 | 新slot保留，返回固定错误，后续可收敛 |
| logout失败 | pointer不清，route不成功 |
| pointer clear失败 | mirror已删但route不成功；重试完成clear |
| list遇 missing slot | response过滤；磁盘不修复 |
| label hint派生失败 | masked id fallback；不阻断生命周期 |

## 兼容性

- API/wire/metadata schema保持。
- PR #13所有行为保留。
- 旧 auth-only用户通过 GET bootstrap。
- 旧 label/remark/quota cache保留。
- 无前端改动，无 UI 原型。

## 风险与缓解

1. **adopt误用导致 stale mirror覆盖slot**
   - 缓解：只允许 login/canonical runtime refresh调用；全仓测试禁止 list/read/failover调用。
2. **锁嵌套死锁**
   - 缓解：public locked vs internal unlocked命名；Grok lifecycle只用 raw store；lock-focused review。
3. **list移除远程 label backfill导致遗留无 label显示 masked id**
   - 缓解：保留现有 persisted label；new mutation本地 derive hint；masked id是既有安全 fallback。
4. **跨文件非数据库事务**
   - 缓解：slot authority、顺序提交、错误不虚报、幂等 retry；不承诺数据库级原子性。
5. **跨进程 forced refresh顺序执行两次**
   - PR #13 provider lock可避免并发写，但两个明确 force请求仍可能顺序各刷新；不属于本 Issue。

## 回滚

- 回滚本 Issue新增的显式 helper/route接线/测试/docs，但**不得**回滚 PR #13 transaction、coordinated store或lock。
- 不删除/迁移 `auth.json`、`auth-accounts/**`、session或usage数据。
- 若紧急 stop-bleed，可停止新 adoption/bootstrap接线并恢复到当前 `3b8285c`行为；不能恢复 PR #13 之前的 mirror-first路径。
