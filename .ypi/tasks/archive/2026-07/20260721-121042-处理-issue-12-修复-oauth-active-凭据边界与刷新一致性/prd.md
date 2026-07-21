# PRD：Issue #12 OAuth Active 凭据边界与刷新一致性

## 目标与背景

当前 Web 同时维护：

- managed account pool：`auth-accounts/<provider>/accounts.json` + opaque credential slot；
- Pi runtime Active mirror：`auth.json[provider]`。

PR #13 已将 Grok managed Active slot 设为 refresh authority，并修复 slot/mirror 写入顺序。但 generic OAuth store 仍把 bootstrap、adopt、list reconciliation、logout cleanup 混在 `syncActiveOAuthAccountCredential()` 中。Issue #12 的剩余目标是把这些边界显式化，让普通读取永远不能把旧 mirror 写回 slot，并补足可重复的并发/轮换/失败收敛证据。

## 用户价值

- Grok refresh token 轮换后不会因列表、配额刷新或账号切换重新使用旧 token。
- logout 后 managed Active 与 runtime mirror 一致，不会被 slot 隐式“登录回来”。
- accounts/providers/quota 查询行为可预测；只读路径不再暗中修改凭据。
- Kiro、Antigravity、OpenAI Codex 共享同一明确生命周期语义，降低后续 provider 扩展风险。

## 范围内

1. 新增并接线四个显式 API：
   - `readOAuthActiveAccountId`
   - `bootstrapOAuthActiveAccountCredential`
   - `adoptOAuthActiveAccountCredential`
   - `clearOAuthActiveAccount`
2. 删除生产调用中的 `syncActiveOAuthAccountCredential`；若无消费者则移除 export/实现。
3. `listOAuthAccounts` 对全部受支持 OAuth provider 无副作用。
4. accounts/providers GET、login、logout、Activate/delete、subscription quota、active-only quota/token/failover 调用点更新。
5. Grok Active mirror failure 后的单向收敛补强。
6. 新增 `test:grok-refresh-consistency` 并纳入 `test:grok-all`。
7. 更新架构、集成、API、library 文档。

## 范围外

- UI / CSS / React component / frontend state 修改。
- API response schema、route path、HTTP method 修改。
- `accounts.json` schema 或现有数据迁移。
- 账号去重、身份合并、自动 failover 规则变化。
- Kiro/Antigravity refresh transaction 重构。
- 自动恢复已被上游消费或撤销的历史 refresh token。
- 发布、版本号、commit、push、merge。

## 功能需求与验收标准

### R1：Active 元数据只读边界

`readOAuthActiveAccountId(provider)` 必须：

- 校验 provider；
- 只读取 `accounts.json` 元数据，并最多检查 opaque slot 是否存在；
- 不打开 credential 内容、不读取 `auth.json`、不发网络请求、不写文件；
- pointer 为空、未出现在 metadata accounts、或 slot 不存在时返回 `null`；
- malformed metadata 按现有安全错误边界 fail closed，不回写空状态。

**验收：** 调用前后 `accounts.json`、slot、`auth.json` bytes/mtime 不变，refresh fixture/fetch 未被调用。

### R2：Legacy bootstrap

`bootstrapOAuthActiveAccountCredential(provider, credentials?)` 必须：

- 在对应 provider account lock 下运行；
- 若存在 adapter-valid managed Active slot，直接返回其 summary，绝不以 `auth.json` 覆盖；
- 仅在没有有效 Active slot 时读取 canonical `auth.json`/传入 store；
- mirror credential 合法时创建/选择 managed slot 并标记 Active；
- mirror 缺失或无效时返回 `null`，不伪造账号、不覆盖其他 slot；
- 重复调用幂等，不为同一个已 bootstrap 状态持续创建新 opaque slot。

**验收：** legacy auth-only 用户首次 GET 得到一个 Active managed account；已有 Active slot 与旧 mirror 冲突时 slot 内容保持原值。

### R3：显式 adopt

`adoptOAuthActiveAccountCredential(provider, credentials?)` 必须：

- 仅供已知成功的 provider-wide login 或 canonical runtime refresh 调用；
- 在 provider account lock 下读取 canonical Active credential；
- 有有效 managed Active 时更新该 opaque slot并保留 pointer/用户 metadata；无有效 Active 时创建 slot并设为 Active；
- mirror credential 缺失/无效时不清理既有 Active，返回 `null` 或抛既定 store error；
- 不被 list、普通 GET、非 Active account refresh 调用。

**验收：** provider-wide login 和 OpenAI Active quota runtime refresh 后，slot 与 `auth.json` 是同一 credential version；adopt failure 不返回虚假 login success。

### R4：显式 clear/logout

`clearOAuthActiveAccount(provider, logout)` 必须：

- 对 Grok/Kiro/Antigravity 在 provider lock 内依次执行 SDK `runtime.logout(provider)` 与 Active pointer clear；OpenAI 保持同一顺序；
- logout 失败时不宣告成功；metadata clear 失败时也不宣告成功；
- 清 pointer 不删除 saved slot，不改 label/quota/history；
- 成功后 `auth.json` 无该 provider，`readOAuthActiveAccountId()` 返回 `null`，saved accounts 仍可重新 Activate。

**验收：** logout + reload 后 provider 未配置；账号列表保留但无 Active；并发 refresh 不能在成功响应后恢复 mirror。

### R5：list 无副作用

`listOAuthAccounts(provider)` 必须对所有 provider：

- 不调用 bootstrap/adopt/sync/refresh/logout；
- 不读 `auth.json`；
- 不写 credential 或 metadata；
- 不执行 `backfillLabel` 网络请求；
- 只投影安全 metadata，缺失 slot 仅从响应过滤，Active 指向缺失 slot时响应为 `null`，不修复磁盘；
- 不返回 access/refresh/idToken/clientSecret/projectId/raw credential/path。

新建/接纳账号的安全 display hint 应在显式 mutation 时从 credential 本地字段派生；用户 label 始终优先且不得被覆盖。遗留无 label 项可回退 masked id。

**验收：** OpenAI/Grok/Kiro/Antigravity list 均通过 zero-write/zero-network/secret sentinel 测试。

### R6：调用点语义

| 调用点 | 必须行为 |
| --- | --- |
| `GET /api/auth/accounts/:provider` | 先显式 bootstrap，再 pure list；bootstrap store error按现有安全错误响应 |
| `GET /api/auth/providers` | 每 provider best-effort bootstrap，失败隔离；随后 pure list + runtime auth status |
| provider-wide login success | managed provider 必须 adopt 成功后再 reload/发送 success |
| add-account login | 仅保存 non-Active slot，不 adopt |
| Grok reauth | 继续走专用 in-place transaction，不重复 adopt |
| logout | 通过 clear 的 lock-held logout 临界区，再 reload |
| Activate/delete/update/import | 不先 sync；mutation 完成后可调用 pure list |
| OpenAI Active subscription quota | runtime refresh 后 adopt，再用 Active reader取 opaque storage id |
| active-only quota/token/session/failover | 用 Active reader；只有需要完整候选列表时才调用 list |

**验收：** production code 不再引用 `syncActiveOAuthAccountCredential`；list 只在确实需要 account summaries/candidates 时使用。

### R7：保留 PR #13

实现不得：

- 恢复 Grok `list -> auth.json -> slot` 路径；
- 把 Grok refresh 改回 mirror-first；
- 回滚 coordinated CredentialStore、provider lock、lock-time reread、force-refresh flight 语义；
- 在已持 Grok provider lock 时调用会再次获取同一锁的 public helper；
- 将 raw lifecycle store 替换成 decorated store导致嵌套锁。

**验收：** PR #13 现有 race/global-auth/account tests 全部通过，diff review 显示窄幅增量而非旧实现替换。

### R8：Grok mirror failure 收敛

- Active refresh 仍先提交 slot，再写 mirror。
- mirror 写失败：向调用者返回固定安全错误，保留新 slot，绝不回滚到已消费 refresh token。
- 恢复可写的旧 mirror 后，下一次同 Active 的有效-token协调解析在 provider lock 下比较 slot/mirror；不一致时只执行 slot → mirror 修复。
- 修复不得再次调用 OAuth refresh，不得对 non-Active slot写 mirror。

**验收：** fixture 只消费一次 R0；失败后 slot=R1/mirror=R0；恢复后普通 token read 使 mirror=R1、fixture call count不增加。

### R9：Grok 并发与轮换测试

专项测试必须使用临时 `PI_CODING_AGENT_DIR`、fixture OAuth provider、真实 production helpers 和 deferred barrier（核心竞态不用 sleep），至少覆盖：

1. Active C0 → C1 slot/mirror一致；
2. 第二次 refresh 提交 R1 而非 R0；
3. refresh held 时 list 不写、不阻塞到错误状态；
4. refresh A → Activate B：最终 Active/mirror=B，A slot保留轮换值；
5. Activate B → refresh A：A 作为 non-Active 只更新自身 slot；
6. 同账号 forced single-flight；
7. upstream failure零写；
8. mirror failure保留 slot并后续无 refresh收敛；
9. list/error/wire 无 secret sentinel。

### R10：文档一致性

文档必须明确：

- slot authority 与 `auth.json` one-way mirror；
- bootstrap vs adopt vs clear；
- list zero-write/zero-network；
- logout 清 pointer但保留 slots；
- mirror failure 与收敛语义；
- API route 的显式 bootstrap/adopt/clear 行为；
- 回滚不得回退 PR #13 或删除用户账号数据。

## 非功能需求

### 安全与隐私

- 错误、API、测试输出、日志不得出现 token、refresh、projectId、clientSecret、raw upstream body 或绝对路径。
- 继续使用 opaque storage id；不把 provider-native id当路径 key。
- 权限保持目录 `0700`、secret/metadata `0600`。

### 并发与锁

- 锁顺序保持 provider account lock → raw WebCredentialStore auth lock。
- public lock-owning helper 与 unlocked internal primitive分层，禁止非重入嵌套。
- list/read helper不获取写锁。

### 兼容性

- route、wire、metadata schema、保存目录、API status主体保持兼容。
- 无数据迁移；旧 slots/metadata原地可用。
- legacy auth-only状态通过显式 GET bootstrap兼容。
- 现有用户 label保留；新 safe hint在 mutation时写入；遗留无 label继续 masked fallback。

## UI

UI gate 不适用；没有 HTML prototype，也不需要 UI 审批。

## 未决问题

无。实现必须等主会话保存计划、进入 `awaiting_approval` 并获得用户批准后开始。
