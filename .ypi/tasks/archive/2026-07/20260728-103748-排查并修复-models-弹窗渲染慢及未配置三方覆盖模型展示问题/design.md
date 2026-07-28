# Design — Models 弹窗性能、导航投影与竞态收敛

## 方案摘要

采用五层收敛：

1. **展示投影层**：新增纯函数识别 override-only provider，Models 左树只遍历可见 raw config。
2. **前端生命周期层**：config、catalog、provider detail 分 lane 管理 generation、AbortController 与 mounted/active guard；本地配置先渲染。
3. **两阶段 auth 状态层**：summary 只读本地状态并先提交；后台 verify 执行有界 `checkAuth()`，仅按同一 provider + 同一 local revision 合并 verification。
4. **服务端并发层**：provider verification 使用 state-keyed cache + single-flight + deadline；一个客户端 abort 不取消共享 flight，超时后的晚到结果不发布。
5. **runtime 基础层**：管理 ModelRuntime 按 cache key 初始化与 offline refresh single-flight，避免首屏 API 冷并发重复注册 fixed providers。

## AS-IS 数据流与已确认竞态

```text
Models click
  -> mount ModelsConfig
     -> GET /api/models-config -------- local file (~22ms)
     -> GET /api/auth/providers ------- per provider bootstrap/list/checkAuth (45ms–4.1s)
     -> GET /api/auth/all-providers --- catalog scan + sequential managed summaries

provider/account switch
  -> old accounts/quota GET may still settle
  -> only Antigravity quota currently has AbortController + generation/accountId guard
  -> Codex/Grok/Kiro/account list/API-key details may accept stale responses

repeat refresh / close / reopen
  -> fetch catch is mostly swallowed
  -> no parent lifecycle generation
  -> old response can race a newer refresh or a mutation response

models.json providers (all)
  -> left raw provider rows
     -> child rows only from models[]
     -> modelOverrides-only provider becomes empty row
```

已确认的具体风险：

- `/api/auth/providers` 将本地目录读取与网络/刷新语义绑定，慢请求阻塞首屏。
- summary、background verify、账号 Activate/Login/Logout 可能乱序；单一 `loggedIn` 无法判断结果基于哪一版本地状态。
- mutation 前启动的 accounts GET 可能在 POST 成功后返回并覆盖新 Active 列表。
- provider/account 切换仅重置 React state，不足以阻止不理会 abort 的旧 Promise 提交。
- 关闭旧 modal 后重新打开会创建新组件实例；仅 AbortController 不足以证明旧请求没有晚到副作用。
- `getWebModelRuntime()` 只有 resolved cache，无 pending init；cache hit 后的 offline refresh 也可能重复并发。

## TO-BE 数据流

```text
Models click -> mount lifecycle L1
  -> modal shell immediately

  config lane C1
    -> GET /api/models-config
       -> success + C1 current -> config/persisted/revision -> filtered raw tree
       -> failure/timeout      -> explicit error; Save disabled; never fake empty config

  catalog lane K1
    -> GET /api/auth/providers?mode=summary ┐
    -> GET /api/auth/all-providers          ├ shared admin runtime init/offline refresh
                                           ┘
       -> each local source may render when ready
       -> OAuth local rows own visibility/account metadata/localStateRevision
       -> local failure -> compact error + retry; config lane remains usable
       -> after OAuth summary commit, start background verify V1

  background verification V1
    -> GET /api/auth/providers?mode=verify
       -> state-keyed provider checkAuth single-flight + bounded deadline
       -> merge only when L1/K1 current AND provider.localStateRevision matches
       -> timeout/error/superseded -> keep local row unchanged

  provider/account mutation M1
    -> invalidate provider/detail generations before sending write
    -> successful POST response is authoritative for its returned account list
    -> trigger new local catalog/detail generation K2/D2
    -> any C/K/V/D request started before M1 cannot commit afterward
```

## 前端竞态模型

### 1. 生命周期与 lane 隔离

`ModelsConfig` 顶层至少维护：

```ts
type LoadPhase = "idle" | "loading" | "ready" | "error";

const activeRef = useRef(true);
const configGenerationRef = useRef(0);
const catalogGenerationRef = useRef(0);
const configAbortRef = useRef<AbortController | null>(null);
const catalogAbortRef = useRef<AbortController | null>(null);
const verifyAbortRef = useRef<AbortController | null>(null);
```

规则：

1. 每次 initial load/retry/reload 先 `++generation`，再 abort 该 lane 旧 controller，再创建新 controller。
2. 每个 async continuation 在解析 body 前后、写 state 前都检查 `activeRef.current && capturedGeneration === currentGeneration && !signal.aborted`。
3. cleanup 按顺序设置 `active=false`、递增所有 generation、abort controllers、clear timers、close EventSource。
4. AbortController 仅用于节省资源；**generation + active** 才是正确性门禁，因为 fetch/provider 可能不响应 abort。
5. config lane 不得被 catalog/verify 写入；catalog failure 不改变 config、revision、dirty 或 Save 状态。
6. mutation 请求不自动重放。若用户关闭 modal，服务端可能已提交写入；UI 回调被忽略，重开后读取最终事实。

### 2. Catalog generation

`refreshCatalog(reason)` 作为唯一入口：

- 递增 `catalogGeneration`，abort 前一轮 OAuth summary、all-providers 与 verify。
- OAuth summary 与 all-providers 可并发、可分源提交；同一轮 generation 外的响应全部忽略。
- OAuth summary 成功后启动 verify；verify 不等待 all-providers，也不阻塞 config。
- Retry、Login/Logout/Activate、账号新增/删除/禁用、provider config 更新均开启新 generation。
- 快速连续 Retry 可以在客户端 abort 旧 HTTP；服务端同 state verification 仍由 single-flight 去重。
- catalog local error 只表示本地目录未加载；verify error 不把成功的 local catalog 改成 error。

建议状态：

```ts
type CatalogState = {
  oauth: LoadPhase;
  apiKey: LoadPhase;
  verification: "idle" | "checking" | "verified" | "degraded";
  safeError: boolean;
};
```

生产 UI 仍只需要原型已有的紧凑 loading/error：

- 两个本地 source 都未完成：`正在读取已配置提供商…`；
- 任一 source 成功：立即显示成功 rows；另一 source pending 可保留小 loading；
- 本地 source 失败：`提供商状态加载失败` + `重试`；
- verify timeout/error：保持本地 rows，不新增黄色卡片或全局错误。

### 3. Provider/account detail generation

顶层 catalog guard 不能替代详情 guard。`OAuthDetail`、`ApiKeyAccountsDetail`、`ApiKeyDetail` 应各自维护 detail generation/controller：

- provider 切换：递增 detail generation，abort accounts/quota/config/reveal read，关闭旧 EventSource，清理敏感 state。
- account 切换：递增 quota generation，abort旧 quota；响应必须匹配 captured `providerId + accountId + generation`。
- 所有 Codex/Grok/Kiro/Antigravity quota 统一应用该规则；不能只保留 Antigravity 特例。
- `loadAccounts()` 同样检查 provider/generation。mutation 开始前使旧 accounts generation 失效，避免旧 GET 覆盖 POST 返回列表。
- Activate/Login/Logout/reauth 成功后：先提交 mutation response 中的安全账号投影，再启动新 generation 的 accounts/quota/catalog revalidation。
- API-key accounts/config 请求按 provider id + generation 校验；revealed plaintext 在 provider 切换/close 时立即清除，旧 reveal response 不得写入新 provider。
- EventSource handler 捕获 `providerId + loginGeneration`；close 后晚到 message/error 均忽略。

### 4. Selection 合并规则

- selection 是用户所有状态，late API 不得无条件重置到第一个 provider。
- config reload/sync 后先尝试保留当前 visible provider/model；仅当最新本地投影证明目标不存在或被过滤时，确定性 fallback 到第一个 visible config，再到第一个 active provider，最后 null。
- background verification 不参与 row 可见性和排序，因此不得造成 selection 跳动。
- deep-link 仍只消费一次；其 effect 只能基于当前 catalog generation，旧 generation 不得触发 `onConsumedFocus()`。

## Provider 状态字段所有权与合并规则

| 字段 | 权威来源 | 后台 verify 是否可覆盖 |
| --- | --- | --- |
| `id/name/authMode/usesCallbackServer` | 最新本地 catalog generation | 仅同 revision 时补充，不重排 |
| `localConfigured` | summary / mutation 后的新 summary | 否 |
| `accountCount/activeAccountDisplayName` | metadata-only summary 或 mutation response | 否 |
| raw config 可见性 | `visibleModelsConfigProviders(config.providers)` | 否 |
| `verification.state/checkedAt` | 同 revision 的 verify | 是 |
| 兼容 `loggedIn` | local 初值；同 revision verified valid/invalid 可更新 | 是，但不能隐藏本地已配置 row |
| selection | 用户操作/确定性 fallback | 否 |
| config draft/revision/dirty | config lane + successful save/sync | 否 |

合并算法：

```text
for each verified item:
  current = providerById[item.id]
  if no current -> ignore
  if item.verification.basedOnRevision !== current.localStateRevision -> ignore
  preserve current.localConfigured/accountCount/activeAccountDisplayName/order
  merge verification only
  derive effective loggedIn for detail status
```

失败/超时/`superseded` 不将 `loggedIn=true` 强制改为 false；只有同 revision 的明确 `valid` / `invalid` 可以更新 verification。provider 行是否存在使用 `localConfigured || accountCount > 0`，不是远端验证结果，因此过期 credential 仍有恢复入口。

## 影响模块与边界

### `components/ModelsConfig.tsx`

- 将单一 `loading` 拆为 config/catalog/verification 状态。
- 引入顶层 active + per-lane generation/controller；response 检查 `res.ok` 与 payload shape。
- `reloadConfigFromServer()` 失败不得设置合法空配置；保留错误状态并禁用 Save。
- `refreshCatalog()` 先 summary，后 background verify；verify 采用 revision-aware field merge，禁止 wholesale `setOauthProviders(response.providers)`。
- raw providers 使用纯 helper filtered projection；selection/reload/sync apply 均使用 visible keys。
- 为 OAuth/API-key details、quota、account list、reveal 与 SSE 补齐 provider/account generation。
- active provider loading/error/retry 使用现有样式变量；HTML 原型无需改动，黄色说明卡不进入生产。

### `lib/models-config-visibility.ts`（建议新增）

纯函数，不依赖 React/文件系统：

```ts
isOverrideOnlyProviderEntry(value: unknown): boolean
visibleModelsConfigProviders(providers: Record<string, ProviderEntry>): Array<[string, ProviderEntry]>
```

判定契约：

- `value` 必须是非数组对象；
- own enumerable keys 恰好为 `modelOverrides`；
- `modelOverrides` 必须是非数组对象（可为空仍视为 override-only metadata）；
- 任意其他 key（包括未知未来字段）=> false，继续显示；
- 过滤是 read projection，绝不修改传入对象。

### `lib/models-provider-auth-summary.ts`（建议新增）

集中 provider local summary / revision / verification cache，避免 route 内拼接并发规则：

- `projectLocalOAuthProviderSummary(runtime, provider)`：metadata-first，零网络、零 credential body 投影。
- `localStateRevision`：进程盐化的不透明摘要，输入仅包含安全本地投影、provider mutation epoch 与必要 authority file stat fingerprint；不返回路径、账号 id、credential hash 或原始 stat。
- `invalidateProviderVerification(providerId)`：所有成功 auth/account mutation 调用，递增 epoch并清该 provider cache。
- `verifyProviderAuth(runtimeKey, runtime, provider, localSnapshot)`：按 `runtimeKey + providerId + localStateRevision` single-flight。
- `__resetModelsProviderAuthSummaryForTests()`：清 cache/flights/epochs/process salt测试状态。

### `app/api/auth/providers/route.ts`

兼容设计：

- `mode=summary`：只投影本地状态，不调用 `runtime.checkAuth()`，不做 legacy bootstrap 写入。
- `mode=verify`：Models 后台使用；默认无 mode 保持现有完整验证兼容语义，但内部可复用 verify service。
- legacy `bootstrapOAuthActiveAccountCredential()` 只允许留在 verify/default或明确 mutation 路径；summary 使用 `listOAuthAccounts()` / `readOAuthActiveAccountId()` / runtime stored status。
- 每个 provider 独立 deadline/结果，route 使用 all-settled，不因一个 provider 超时清空全部结果。
- 返回固定安全 error enum，不返回 exception message。
- `Cache-Control: no-store`；进程内短 TTL 不改变 HTTP 缓存语义。

### Auth/account mutation routes

成功提交后调用 `invalidateProviderVerification(providerId)`，至少覆盖：

- `app/api/auth/login/[provider]/route.ts`
- `app/api/auth/logout/[provider]/route.ts`
- `app/api/auth/accounts/[provider]/route.ts`
- `app/api/auth/accounts/[provider]/activate/route.ts`

invalidate 必须发生在持久 mutation 成功后、成功 response 前；失败写不 bump。客户端 mutation generation 仍是必要的第二层保护。

### `app/api/auth/all-providers/route.ts`

- 一次扫描 `runtime.getModels()` 得到 stable provider order + `Map<provider, count>`。
- managed provider summary 使用 Promise.all enrichment，不在 for-loop 串行 await。
- endpoint 保持本地/无 provider 网络；由 catalog generation 解决 response 乱序。
- AnyRouter recoverable synthetic entry、`Cache-Control: no-store` 与 safe diagnostic 保持。

### `lib/web-model-runtime.ts`

新增：

```ts
const adminRuntimePending = new Map<string, Promise<AdminRuntimeCacheEntry>>();
const adminRuntimeRefreshPending = new Map<string, Promise<void>>();
```

算法：

1. canonical `agentDir + modelsPath` 得到 key。
2. resolved 未命中时取/建 init pending；owner 创建 credentials/runtime并固定 offline 注册 providers。
3. 初始化成功才写 resolved cache；reject/finally 清 init pending，失败可重试。
4. resolved/init waiter 取得 entry 后，对 Models 所需 offline refresh 使用同 key refresh single-flight。
5. `allowModelNetwork=true` 不得污染共享初始化；网络 refresh 不与首屏 offline summary 混成一个会阻塞本地状态的 flight。
6. refresh reject/finally 清 refresh pending；resolved runtime是否保留按现有 refresh可恢复语义决定，但 pending绝不能永久挂住。
7. reset helper 清 resolved/init pending/refresh pending/summary verification cache（后者可由测试显式分别 reset）。

并发模型：只合并同 key；不同 agentDir/modelsPath 隔离。`checkAuth()` verification flight 与 runtime init/refresh flight 是两类 map，不能互相等待形成循环。

## 服务端 verification cache、single-flight 与 deadline

### Key 与 TTL

建议常量（实现时可集中定义并测试，不暴露为用户配置）：

- success/invalid cache TTL：15s；
- error 不缓存，或仅 2s anti-hammer cooldown；
- 单 provider response deadline：8s；
- 底层忽略 abort 的 flight 最长保留：30s，期间新 waiter复用 timeout/superseded结果，不叠加真实 `checkAuth()`。

Key：`adminRuntimeKey + providerId + localStateRevision`。local revision变化或 mutation invalidate 后不得命中旧 cache。

### Flight 生命周期

```text
no cache + no flight -> owner starts checkAuth
same key waiter      -> await same public result
one HTTP disconnect  -> detach waiter only; do not cancel shared owner
owner <= deadline    -> valid/invalid/error + basedOnRevision
owner > deadline     -> public timeout; mark flight non-publishable
late owner settles   -> do not write cache/old response; cleanup flight
retention exceeded   -> cleanup tombstone so later request can retry
```

服务端 timeout 不能保证第三方 `checkAuth()`停止或回滚它已执行的 token refresh。正确语义是：

- timeout 后不再发布该结果；
- refresh 对 canonical credential 的合法写入由原 provider lock/store 负责；
- 下一次 local summary 读取新事实并产生新 revision；
- 不自动重试 write/refresh，不因晚到 completion 覆盖客户端新 generation。

### Mutation 与 verify 的关系

- verify 开始时捕获 provider mutation epoch/local revision。
- mutation 成功后 bump epoch、清 cache；客户端立即开启新 catalog generation。
- verify 返回时若 revision/epoch不匹配，返回 `superseded` 或直接省略 verification，不缓存。
- mutation POST 的安全 response在详情 state中优先；旧 GET/verify无权覆盖。

## API 契约

### `/api/auth/providers?mode=summary`

现有字段保留，新增字段 additive：

```json
{
  "providers": [{
    "id": "grok-cli",
    "name": "Grok CLI (SuperGrok / X Premium)",
    "usesCallbackServer": false,
    "loggedIn": true,
    "localConfigured": true,
    "localStateRevision": "opaque-process-local-token",
    "statusBasis": "local",
    "authMode": "managed_accounts",
    "accountCount": 2,
    "activeAccountDisplayName": "work"
  }]
}
```

`loggedIn` 在 summary mode是兼容初值；Models 的 row visibility 使用 `localConfigured/accountCount`。

### `/api/auth/providers?mode=verify`

```json
{
  "providers": [{
    "id": "grok-cli",
    "verification": {
      "state": "valid",
      "basedOnRevision": "opaque-process-local-token",
      "checkedAt": "2026-07-28T10:00:00.000Z"
    }
  }]
}
```

`verification.state` allowlist：`valid | invalid | timeout | error | superseded`。无 raw provider message。客户端仅同 revision merge；unknown provider忽略。

### `models.json`

- 无 schema/migration。
- hidden provider 仍存在于 `config` / `persistedConfig`，PUT body完整保留。
- 过滤 helper、auth summary、verification 均不参与序列化。

## 失败与降级

| 失败点 | UI/状态 | 重试策略 |
| --- | --- | --- |
| models-config GET malformed/500/timeout | 明确错误，Save disabled；不制造空 config | 用户显式重试/重开 |
| OAuth local summary失败 | custom tree可用；active区固定错误 | 用户点击重试，新 generation |
| all-providers失败 | 成功的 OAuth rows保留；固定错误 | 用户点击重试，新 generation |
| background verify timeout/error | 保留 local rows与counts，不全局报错 | TTL/cooldown后下次打开或mutation再验 |
| provider A detail晚到但已切 B | 丢弃 | B自己的 generation继续 |
| account A quota晚到但已切账号 B | 丢弃 | B自己的请求继续 |
| runtime init失败 | route安全失败；pending清除 | 后续请求重试 |
| shared checkAuth超时后晚到 | 不缓存、不发布 | retention后允许新 flight |

## 性能预算与观测

- Shell：React click 后下一帧可见。
- Config tree：只等待 `/api/models-config`。
- Summary route：结构上零外部 auth check；warm 本机目标 ≤500ms。
- Background verify：不属于首屏关键路径；单 provider deadline 8s，route可部分完成。
- 冷并发：同 key fixed-provider registration = 1；同 key offline refresh = 1；同 provider+revision真实 `checkAuth()` = 1。
- 不新增持久遥测；验证使用 curl `time_starttransfer/time_total`、可控 deferred test与浏览器 Performance/Network。

## 兼容性

- 默认 `/api/auth/providers` 完整模式保留；Models 显式使用 summary + verify。
- additive `localConfigured/localStateRevision/statusBasis/verification` 可被旧客户端忽略。
- OAuth login SSE、account CRUD、quota API wire不变，只补客户端 lifecycle guard与成功后的 cache invalidation。
- AnyRouter synthetic card、Grok/Kiro/Antigravity managed account投影不变。
- `modelOverrides` 的模型价格来源、explicit-free与runtime merge不变。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| local summary将过期 credential显示为已配置 | 明确定义为本地状态；background verify/详情 quota负责恢复；row不消失 |
| verify based on旧 Active覆盖新账号 | local revision + mutation epoch + client generation三层拒绝 |
| AbortController给出虚假安全感 | 所有 commit必须同时检查 active与generation；测试用“忽略abort的deferred promise” |
| checkAuth timeout后仍刷新credential | timeout只截断发布；底层合法写由provider lock负责；晚到结果不缓存，下一summary读取事实 |
| 单客户端abort取消共享flight | server flight不绑定HTTP signal；abort只停止该waiter |
| 快速重复打开造成checkAuth风暴 | state-keyed single-flight + 15s进程缓存 + 2s错误cooldown |
| stale accounts GET覆盖Activate POST | mutation开始先invalidate detail generation；POST response优先并触发新GET |
| provider切换泄漏key/旧详情 | abort+generation+providerId guard；unmount清revealed key/EventSource |
| selection随verify闪跳 | verify不拥有visibility/order/selection；只merge verification |
| 误隐藏未来provider config | 仅keys恰好为`modelOverrides`才隐藏；未知字段fail-visible |
| 保存时丢hidden项 | filter仅render projection；PUT仍发送完整config；测试保留字节语义 |
| runtime pending永久失败 | init/refresh finally清理；失败不写resolved；reject后重试测试 |
| 跨进程直接改credential未走invalidate | local revision含安全file-stat fingerprint，验证TTL短；仍以重开/详情校验收敛 |

## 回滚

- 前端停止 background verify、回到仅 local summary即可止血，不影响存储。
- 撤回过滤与 summary URL可恢复旧投影；API additive mode可保留。
- verification cache/single-flight和runtime single-flight可分别回滚；无持久数据迁移。
- 不删除/回写任何 models.json、auth.json或account slot。
