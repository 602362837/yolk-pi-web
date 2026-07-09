# Design — opencode-go 自动 failover、账号禁用与并发安全

## 方案摘要

新增 `opencode-go` 专用 failover controller，复用 ChatGPT/OpenAI Codex 多账号切换的核心模式，但按 API Key managed accounts、OpenCode Zen Go 错误形态和账号启用/禁用语义适配：

1. agent 运行时在每次 `opencode-go` provider 请求前记录本次请求绑定的 active account id。
2. pi 原生 retry/compaction 先处理；只有 `_handlePostAgentRun()` 返回不继续后，才尝试 failover。
3. failover controller 判断错误是否为明确 quota/account-unusable；普通 transient 错误不切号。
4. `account_unusable`（Invalid/Missing API key 等）在锁内持久禁用触发账号，避免其继续参与候选轮换。
5. 进入进程级 mutex 后做 active-changed guard 和 activate 前 double-check。
6. 成功激活候选账号后移除本轮失败 assistant message，返回 `retry=true` 让当前 turn 重试一次。
7. Settings UI 提供默认关闭开关、账号 Enable/Disable 操作、策略说明和 Chat 事件提示；HTML 原型见 [opencode-go-failover-ui.html](./opencode-go-failover-ui.html)。

## 影响模块和边界

### 新增/修改建议

- `lib/opencode-go-account-failover.ts`（新增）
  - 错误分类、全局锁、cooldown、disabled 跳过、candidate selection、failover attempt。
- `lib/api-key-accounts.ts`
  - 复用 `listApiKeyAccounts()`、`activateApiKeyAccount()`。
  - 新增/扩展 non-secret metadata：`disabled`, `disabledAt`, `disabledReason`, `disabledBy`, `autoDisabledReason`, `enabledAt`, `enabledBy`。
  - 新增 helper：`disableApiKeyAccount(provider, accountId, reason, options)`、`enableApiKeyAccount(provider, accountId)`、`getActiveApiKeyAccountId(provider)`。
  - `activateApiKeyAccount()` 拒绝 disabled 账号。
- `app/api/api-key-accounts/**` 或现有账号管理 route
  - 增加 enable/disable 操作 endpoint，或扩展现有 update endpoint。
  - 服务端校验 disabled active 约束。
- `lib/pi-web-config.ts`
  - 新增 `opencodeGo.autoFailover` 配置，默认关闭。
- `lib/rpc-manager.ts`
  - 在 `AgentSessionWrapper` 增加 opencode-go failover patch，或抽象现有 ChatGPT patch 成 provider failover hook。
  - 继续从 `reloadRpcAuthState()` 刷新 live wrappers。
- `hooks/useAgentSession.ts` / `components`（本次纳入 UI）
  - 处理 `opencode_go_account_failover` SSE 事件并展示提示。
- `components/SettingsConfig.tsx` / 账号管理组件（本次纳入 UI）
  - 新增开关、策略说明、Enable/Disable 操作、disabled 状态展示。
- 文档
  - 更新 `docs/modules/library.md`、`docs/modules/api.md`、`docs/modules/frontend.md`、`docs/architecture/overview.md`。

### 非目标边界

- 不改 pi-ai provider 端点，不 fork 上游 SDK。
- 不读取或显示 plaintext API key。
- 不绕过 `AuthStorage`/`ModelRegistry`；active key 仍通过 `auth.json` 镜像。
- 不把 cooldown 持久化；持久化的是用户/系统明确 disabled 状态。

## Managed account 禁用/启用契约

### Metadata

建议在现有 managed account metadata 中 additive 增加：

```ts
interface ApiKeyAccountMetadata {
  disabled?: boolean;
  disabledAt?: string;
  disabledReason?: string;
  disabledBy?: "user" | "system";
  autoDisabledReason?: "account_unusable" | "manual";
  enabledAt?: string;
  enabledBy?: "user" | "system";
}
```

规则：

- 不写入 plaintext key。
- `disabled !== true` 视为 enabled，兼容旧数据。
- disabled 状态持久化到现有账号 metadata sidecar。
- 启用账号会清除 `disabled*` 字段或将 `disabled=false` 并记录 `enabledAt/enabledBy`。

### Helper / API 契约

- `disableApiKeyAccount('opencode-go', accountId, { reason, disabledBy, replacementAccountId?, clearActive? })`
  - 非 active 账号可直接禁用。
  - active 账号禁用时必须满足以下之一：
    - 同事务激活 `replacementAccountId`；或
    - 明确 `clearActive=true`，清空 active metadata/auth mirror；或
    - 自动 failover 在同一锁内找到候选并激活。
  - 不允许操作后留下 disabled account 仍为 active。
- `enableApiKeyAccount('opencode-go', accountId)`
  - 仅恢复资格，不自动设为 active。
- `activateApiKeyAccount('opencode-go', accountId)`
  - 若 account disabled，拒绝并返回/抛出 typed error，例如 `ApiKeyAccountDisabledError`。

### UI 语义

- disabled 账号保留在列表，可查看 display name、masked preview、disabled reason。
- disabled 账号的 Activate 按钮禁用，提示“Enable before activating”。
- Enable 后才能手动激活或作为 failover 候选。
- Disable active 账号必须弹确认，优先要求选择替代账号。

## 真实错误形态研究

### 已从代码确认

- `@earendil-works/pi-ai/dist/providers/opencode-go.js`：
  - provider id: `opencode-go`
  - auth: `envApiKeyAuth("OpenCode API key", ["OPENCODE_API_KEY"])`
  - API: `anthropic-messages` 与 `openai-completions`
- `opencode-go.models.js`：
  - OpenAI-compatible: `https://opencode.ai/zen/go/v1`
  - Anthropic-compatible: `https://opencode.ai/zen/go`
- `AgentSession._isNonRetryableProviderLimitError()` 已将以下视为非 transient：
  - `GoUsageLimitError`
  - `FreeUsageLimitError`
  - `Monthly usage limit reached`
  - `available balance`
  - `insufficient_quota`
  - `out of budget`
  - `quota exceeded`
  - `billing`

### 已从公开端点探测确认

- `GET https://opencode.ai/zen/go/v1/models` 可公开返回模型列表。
- 无 key OpenAI-compatible chat request 返回：
  - HTTP `401`
  - body `{"type":"error","error":{"type":"AuthError","message":"Missing API key."}}`
- 坏 key OpenAI-compatible chat request 返回：
  - HTTP `401`
  - body `{"type":"error","error":{"type":"AuthError","message":"Invalid API key."}}`
- Anthropic-compatible `/messages` 使用 `x-api-key` 时坏 key同样返回 `AuthError Invalid API key`。

### quota / usage / balance 探测结论

- **确认有（产品层）**：OpenCode Zen docs 提到 account balance、auto-reload、monthly usage limits、credits。
- **当前项目/SDK 确认无**：未发现 opencode-go quota/balance 查询 route/helper/cache。
- **未发现可靠公开能力**：公开 docs 的 API endpoints 只列模型调用端点，未发现 API Key 可调用的余额/额度查询 endpoint。因此 v1 采用纯被动 failover。

## 触发条件设计

### Eligible: `quota_exhausted`

仅当 provider 为 `opencode-go`，assistant message `stopReason === "error"`，且错误文本/结构匹配以下明确 quota/账单形态：

```text
GoUsageLimitError
FreeUsageLimitError
Monthly usage limit reached
available balance
insufficient_quota
out of budget
quota exceeded
billing
payment required / 402 + credits|balance|quota|monthly limit
usage limit reached
```

该类错误进入进程内 `exhaustedUntil` cooldown，不自动持久禁用账号。

### Eligible: `account_unusable`

用于“该账号不能继续调用”的永久账号问题：

```text
AuthError + Invalid API key
AuthError + Missing API key
401/403 + unauthorized|forbidden|invalid api key|missing api key
```

该类错误会在锁内持久禁用 trigger account：

- `disabled=true`
- `disabledBy="system"`
- `disabledReason="Account unusable: Invalid API key"`（按实际错误归一化）
- `autoDisabledReason="account_unusable"`

### Not eligible

以下不切换账号：

- 普通 `429`、`rate limit`、`too many requests`，除非同时包含明确 monthly/quota/balance 文案。
- 网络/连接/timeout/fetch failed/stream ended/5xx/provider returned error。
- context overflow（交给 compaction）。
- content filter/refusal。
- 非 `opencode-go` provider。

## 并发安全设计

### 全局状态

```ts
interface OpencodeGoFailoverGlobalState {
  lock: Promise<void> | null;
  exhaustedUntil: Map<string, number>;       // quota cooldown
  lastSwitchAt: number;
}

globalThis.__piOpencodeGoFailover ??= { ... };
```

`account_unusable` 不依赖进程内 `unusableUntil`，而是写入持久 disabled metadata。进程内可保留短期 cache，但候选筛选必须以 metadata 为准。

### 请求绑定触发账号

- 在每次 `opencode-go` provider 请求真正取 auth 前，记录 `requestAccountId = activeAccountId`。
- 推荐 patch `AgentSession` 的 `_getRequiredRequestAuth(model)` 或在 `AgentSessionWrapper` 内维护 `lastOpencodeGoRequestAccountId`。
- failover 使用“失败请求绑定账号”而不是“失败后当前 active 账号”。否则并发切换后会误判并级联。

### 锁内流程

```text
request bound to A fails with quota/account_unusable
  ↓
attemptFailover(triggerAccountId=A, turnBudget)
  ↓
if budget exhausted → no retry
  ↓
with global mutex:
  if reason=account_unusable:
      persist disabled(A) unless already disabled
  else:
      mark A exhausted cooldown
  activeAfterLock = current active
  if activeAfterLock != A:
      // another session already did A→B or A was cleared
      return retry=true, switch=false
  wait minSwitchInterval if needed
  choose candidate excluding active/A/disabled/cooldown/attempted
  if no candidate:
      if A is disabled: clear active mirror or leave cleared per approved policy
      return retry=false, status=no_usable_account
  activeBeforeActivate = current active
  if activeBeforeActivate != A:
      return retry=true, switch=false
  activate candidate B (activation rejects disabled accounts)
  reloadRpcAuthState()
  return retry=true, switched=B
```

### 避免 A→B 与 B→C 级联

- session1、session2 都以 A 发起请求并失败。
- session1 获得锁，A quota cooldown 或 disabled，然后 A→B。
- session2 进锁后发现 active 已是 B，返回 `already_switched_by_other_session`，只 retry，不切到 C。
- 每 turn 默认 budget=1，session2 若 retry B 仍失败，也不会在同一 turn 继续 B→C。

## Candidate selection

候选账号来自 `listApiKeyAccounts('opencode-go')`：

- 跳过 active account。
- 跳过 trigger account。
- 跳过当前 turn `attemptedAccountIds`。
- 跳过 `disabled === true` 账号。
- 跳过 `exhaustedUntil` 未过期账号。
- 跳过缺失 secret 或 list 中不存在的账号（`listApiKeyAccounts` 已有 missing secret prune）。
- 排序建议：从 trigger 在当前账号列表中的下一个账号开始环形遍历；若 trigger 不在列表，按现有 list order。

## Budget 与 cooldown

推荐默认：

```json
{
  "enabled": false,
  "maxAttemptsPerTurn": 1,
  "maxAccountSwitchesPerTurn": 1,
  "exhaustedCooldownMs": 1800000,
  "minSwitchIntervalMs": 10000
}
```

- `attempts`：failover 导致的 retry 次数。
- `switches`：实际 activate 次数；“其他 session 已切换，只 retry”不增加 switches，但增加 attempts。
- `exhaustedCooldownMs`：quota/billing 类临时跳过。
- `account_unusable`：持久 disabled，直到用户重新 enable。

## 纯被动 failover 与未来 quota cache

### v1：纯被动

- 不主动请求 quota/balance。
- 只在失败后标记当前账号 cooldown 或 disabled，并选择下一个 enabled 候选。
- UI 不展示余额，只展示运行期切换事件与 disabled reason。

### future：如果官方公开 quota API

- 新增 `lib/opencode-go-quota.ts`，只查询公开、稳定、API-key 授权的 endpoint。
- `ApiKeyAccountMetadata` 可扩展 `quotaCache`，但不能存 plaintext。
- candidate selection 优先选择 fresh cache 中 balance/monthly-limit 可用账号；cache stale 时可受控刷新。
- quota API 不可用或失败时降级为纯被动，不阻塞聊天。

## 事件契约

建议 SSE 事件：`opencode_go_account_failover`。

```ts
interface OpencodeGoAccountFailoverEvent {
  provider: "opencode-go";
  status:
    | "switched"
    | "already_switched_by_other_session"
    | "no_usable_account"
    | "disabled_account"
    | "not_eligible"
    | "budget_exhausted";
  reason?: "quota_exhausted" | "account_unusable";
  triggerAccountId?: string;
  switchedToAccountId?: string;
  disabledAccountId?: string;
  retry: boolean;
  message: string;
}
```

事件不得包含 plaintext API key。前端用 displayName/masked preview 展示。

## 兼容性、风险、回滚

- 默认关闭，回滚可通过配置关闭或删除新 controller patch。
- disabled metadata 是 additive，旧账号默认 enabled。
- `activateApiKeyAccount()` 新增拒绝 disabled 账号是行为变化，但符合用户确认的语义；需要 UI/API 错误提示。
- 运行期锁是进程内；多进程 PM2 cluster 仍可能并发切换。当前部署若单进程可接受；多进程需文件锁或外部锁作为 v2。
- 账号切换是全局副作用，UI/文档必须明确。
- 错误匹配需保守，避免普通 rate limit 切号。
- 如果自动禁用 active 且无候选，需按审批决定清空 active mirror；这是可回滚/可关闭的默认关闭功能。