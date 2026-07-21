# Design：Grok Active 刷新凭据一致性

## 1. 方案摘要

推荐采用“**saved-account 真相 + Active 单向镜像 + 显式接纳 + provider lock 串行化**”方案：

1. 为 OAuth account store 提供无 secret 写副作用的 Active metadata 读取契约。
2. `listOAuthAccounts()` 不再无条件执行 `auth.json -> saved-account`；普通列表不能写 access/refresh。
3. legacy auth-only bootstrap、成功 OAuth login、需要从 canonical runtime 接纳新 credential 的场景使用命名明确的显式同步入口。
4. Grok refresh 在 `withGrokProviderLock()` 内读取最新账号凭据、判断/复核 Active、原子写账号文件，并把 Active 的同一新 credential 写入 `auth.json`。
5. Active 镜像写入是“刷新成功”的一部分；失败时保留已轮换的新账号凭据、返回安全错误，后续 resolver 用新凭据重试镜像，不得恢复旧 refresh token。

不推荐只把 Grok resolver 中的一次 `listOAuthAccounts()` 替换为直接读文件：这只能消除确定性覆盖，不能阻止外部列表/显式同步在刷新窗口读取旧 `auth.json` 后回写。

## 2. 现状与根因

当前 Active 刷新顺序：

```text
refresh(C0) -> C1
write account(A)=C1
listOAuthAccounts()
  -> syncActiveOAuthAccountCredential()
  -> read auth.json=C0
  -> write account(A)=C0
write auth.json=C1
```

最终可能成为：

```text
accounts.json.activeAccountId = A
A.json                        = C0
Auth mirror                   = C1
```

问题不是单纯 CAS 缺失，而是两个职责冲突：

- refresh 把 saved-account 当真相并向 Active mirror 发布；
- list 又把 Active mirror 当真相反向覆盖 saved-account。

两个文件没有共同事务；一旦 refresh token 轮换，任何“最后写入旧快照”的路径都会造成不可恢复的凭据回退。

## 3. 权威性与不变量

| 数据 | 权威性 | 允许写入者 |
| --- | --- | --- |
| `accounts.json.activeAccountId` | managed Active 指针 | Activate、显式 bootstrap/login/disconnect 元数据操作 |
| `<storage-id>.json` | 该槽位完整 OAuth 凭据真相 | add/login 接纳、refresh、reauth |
| `auth.json["grok-cli"]` | 当前 Active 的派生镜像 | Activate、Active refresh、Active reauth、显式 login/disconnect |

目标不变量：

- **I1**：普通 list 不把 `auth.json` secret 写入已存在槽位。
- **I2**：Active refresh 成功返回后，账号文件与 mirror 为同一新 credential。
- **I3**：非 Active refresh 只写自身槽位。
- **I4**：一旦获得轮换后的 credential，不以旧 mirror 回滚它。
- **I5**：所有会改变 Grok Active 指针、Active secret 或 Active mirror 的路径共享 provider lock。
- **I6**：metadata 解析失败时 fail closed，不猜测 Active。

## 4. 模块设计

### 4.1 `lib/oauth-accounts.ts`：拆分读取、投影与接纳

建议抽出三个内部/公开边界，最终命名可遵循附近风格：

1. `readOAuthActiveAccountId(provider)`
   - 只读并规范化 `accounts.json`；
   - 验证 `activeAccountId` 对应 metadata entry 和 credential 文件；
   - 返回 `string | null`，格式/读取错误抛安全 store error；
   - 不读 `auth.json`，不回填 label，不写任何文件。

2. `projectOAuthAccounts(provider)`（可为 module-private）
   - 从 metadata/credential 存在性生成现有 `OAuthAccountsList`；
   - 可以保留安全 label backfill 与失效 metadata 清理，但不得写 secret；
   - 供 public list 以及已持有 provider lock 的 mutation 返回结果，避免嵌套非重入锁。

3. 显式 Active credential 接纳
   - 区分 `bootstrap`（仅没有有效 managed Active 时）与 `replace-active`（成功 login/runtime refresh 明确要求接纳）语义；
   - `bootstrap` 不覆盖已存在的有效 Active 槽位；
   - Grok 的 `replace-active` 必须持有 `withGrokProviderLock()`；
   - 保留 OpenAI Codex canonical runtime refresh 所需的显式同步，不再由普通 list 偶然完成。

`listOAuthAccounts(provider)` 对所有 provider 取消“无条件 secret 同步”最能使函数名与行为一致。为保持兼容，需审计并调整：

- `app/api/auth/providers/route.ts`：只做 bootstrap，不覆盖现有槽位；
- `app/api/auth/accounts/[provider]/route.ts`：需要兼容 auth-only 初始状态时先 bootstrap，再 list；
- `app/api/auth/login/[provider]/route.ts`：普通成功 login 明确 replace/adopt；add/reauth 保持各自路径；
- `app/api/auth/logout/[provider]/route.ts`：显式清理 Active 指针/镜像展示状态，不依赖下一次 list 的隐式副作用；saved accounts 不删除；
- `lib/subscription-quota.ts`：OpenAI runtime refresh 后继续显式接纳最新 credential；
- `activateOAuthAccount()` / `deleteOAuthAccount()`：不在已持锁区调用会再次取锁的 public wrapper，使用内部无锁投影。

共享 list 契约会影响 Grok/Kiro/Antigravity/OpenAI 的读取路径，因此必须跑跨 provider 回归；但本任务不改变 Kiro/Antigravity refresh 算法或 wire contract。

### 4.2 `lib/grok-account-token.ts`：锁内提交

推荐流程：

```text
single-flight(storageId)
  -> withGrokProviderLock
      -> read latest account credential C0
      -> read Active metadata (no auth/list side effect)
      -> if token still valid:
           if account is Active, ensure auth mirror converges to C0
           return C0.access
      -> call provider refresh(C0) => C1
      -> atomic write account=C1
      -> re-read Active metadata (CAS)
      -> if still Active:
           write auth mirror=C1; failure => safe error, preserve account=C1
      -> else:
           do not touch auth mirror
      -> return C1.access
```

说明：

- 锁前/锁内均以锁内重读为准；`forceRefresh` 语义保持。
- Active 状态在上游调用前可先验证，避免 metadata 已损坏时消费一次性 refresh token；镜像前仍复核以保持 CAS 防御。
- 账号文件先于 mirror 写入，因为轮换后的 refresh token 不可丢。跨文件无法真正原子提交，故失败优先保护新 saved credential。
- Active mirror 错误不能继续被 best-effort 吞掉并返回 `refreshed:true`。错误必须固定、安全，不含 token/路径/上游正文。
- 为修复“账号 C1 已保存、mirror 写失败”的中间态，resolver 在无需刷新但目标为 Active 时也执行 mirror convergence；实现可先比较 canonical credential 后再 `modify`，也可接受低频 resolver 路径的一次原子 no-op 写，不能跳过恢复能力。

### 4.3 Provider lock 与非重入约束

`withGrokProviderLock()` 是非重入锁。实现必须遵守：

- public 显式同步可负责取锁；
- 已在 refresh/Activate/reauth/delete 锁内的代码只调用 `*Unlocked`/内部投影；
- `listOAuthAccounts()` 不应为了 secret 安全而简单套锁后又从锁内调用它；应先移除 secret 写副作用并拆分内部函数。

锁保护矩阵：

| 操作 | Grok provider lock | Secret 方向 |
| --- | --- | --- |
| list/project | 不需要 | 无 secret 写 |
| legacy bootstrap | 需要 | auth -> 新 managed slot，仅无有效 Active 时 |
| normal OAuth login adopt | 需要 | 新 login credential -> Active slot/mirror |
| refresh | 需要 | slot C0 -> slot C1；若 Active，再 -> mirror C1 |
| Activate | 需要 | target slot -> Active pointer/mirror |
| reauth | 需要 | new login credential -> target slot；若 Active，再 -> mirror |
| logout/disconnect | 需要 | clear mirror/Active 展示；保留 saved slots |

### 4.4 文件提交与权限

- 账号 secret：同目录 tmp，`0600`，`rename` 替换；目录 `0700`。
- `auth.json`：继续只通过 `WebCredentialStore.modify/delete`，使用 auth-file process queue + mkdir lock + lock-time 重读 + atomic rename。
- metadata：不新增字段、不做迁移。
- 不在日志或错误中输出 credential、上游响应或绝对路径。

## 5. 并发时序

### 5.1 Refresh A 与 list

list 不写 secret，因此无论在 refresh 前、中、后运行，都最多观察旧/新摘要时间戳，不可能执行 `auth C0 -> A C0`。refresh 完成后 A 与 mirror 均为 C1。

### 5.2 Refresh A 与 Activate B

两者共享 provider lock，只有两种合法串行结果：

- refresh A 先：A=C1、mirror=A(C1)，随后 Activate B，最终 Active/mirror=B，A 保留 C1；
- Activate B 先：最终 Active=B，随后 refresh A 只更新 A=C1，不写 mirror。

### 5.3 同一账号并发 refresh

同一进程继续复用 `inflightRefreshes`。跨进程依靠 provider lock 和锁内重读避免旧值后写；本 Issue 不新增跨进程 single-flight 保证。非 `forceRefresh` 的后到进程应看到新 expiry 后跳过刷新；两个跨进程 `forceRefresh:true` 仍可能顺序执行两次，这是既有语义，不在本 Issue 扩展。

### 5.4 镜像失败

```text
refresh C0 -> C1
account=C1 succeeds
mirror=C1 fails
=> preserve account=C1, return safe persistence error
next resolver call reads C1, sees Active, retries mirror convergence
=> account=C1, mirror=C1, then success
```

不得把 account 回滚为 C0，因为 `C0.refresh` 可能已被上游作废。

## 6. API 与文件契约

- HTTP route、请求体和响应 JSON 不变。
- `OAuthAccountsList`、metadata version、opaque id 不变。
- 不新增 Session JSONL 字段，不迁移现有文件。
- 可新增 server-only helper；不得暴露 credential 或绝对路径到 wire。

## 7. 兼容性

- **Legacy auth-only**：通过显式 bootstrap 保留首次发现能力。
- **Login**：普通 login 明确接纳；`accountMode=add` 不替换 Active；reauth 保留槽位。
- **Logout**：明确清理 Active 展示/mirror，saved accounts 仍保留。
- **OpenAI Codex**：canonical runtime refresh 后显式同步逻辑保留。
- **Kiro/Antigravity**：不改 refresh 算法；因共享 list 行为收敛，必须运行 accounts 与 refresh/Activate race 回归。
- **Rollback**：回退代码即可；不删除/重写 `auth.json`、saved account、quota cache 或 Session JSONL。若紧急止血，可先关闭触发 Grok quota/failover 的调用，但正式回滚仍应恢复整组 store/resolver 改动，避免半套 authority 规则。

## 8. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 拆除 list 隐式同步后遗漏合法接纳调用方 | 全仓搜索 `listOAuthAccounts`/`syncActiveOAuthAccountCredential`，用 auth-only/login/logout/OpenAI refresh 契约测试覆盖 |
| provider lock 嵌套死锁 | public locked wrapper 与 internal unlocked/projector 分层；测试受控并发与超时 |
| mirror 失败后返回了不可持续 token | Active mirror 作为成功条件；保留 C1 并在有效 token 路径重试 convergence |
| metadata 损坏时猜错 Active | fail closed；刷新前验证、镜像前复核 |
| 共享改动影响 Kiro/Antigravity/OpenAI | 不改 wire/schema，追加三 provider accounts/race 测试和 OAuth aggregate suite |
| 测试泄漏 sentinel token | 仅在断言内部读取；console/error/list serialization 显式断言不含 sentinel |

## 9. 关键决策

- 采用 saved-account 真相、`auth.json` 单向 Active 镜像。
- 采用共享的无 secret 写 Active metadata helper，不在 Grok resolver 重复解析 schema。
- 普通 list 取消无条件 secret 同步；bootstrap/login/runtime refresh 改为显式接纳。
- Active mirror 失败不回滚轮换 token，调用失败并允许后续收敛。
